// src/services/googleCalendar.ts
import { prisma } from "../lib/prisma";
import { getGoogleAccessToken } from "./googleAuth";

const SAO_PAULO_TZ = "America/Sao_Paulo";

// default: não spammar convites. Se quiser que apareça/mande convites, mude pra "all"
const SEND_UPDATES = (process.env.GOOGLE_CALENDAR_SEND_UPDATES ?? "none") as
  | "none"
  | "all"
  | "externalOnly";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function addOneDay(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function uniqueEmails(emails: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      emails
        .map((e) => (e ?? "").trim().toLowerCase())
        .filter((e) => e && e.includes("@"))
    )
  );
}

function toDateIsoFromTerm(term: Date) {
  // você salva 00:00 SP como 03:00Z; YYYY-MM-DD sai correto
  return term.toISOString().slice(0, 10);
}

function buildEventBody(args: {
  summary: string;
  description?: string;
  startDateIso: string; // YYYY-MM-DD
  deadlineTime?: string | null; // HH:MM
  attendeeEmails?: string[];
  taskId?: string; // opcional: pra rastrear no Google
}) {
  const { summary, description, startDateIso, deadlineTime, attendeeEmails, taskId } = args;

  const body: any = {
    summary,
    description: (description ?? "").trim() || undefined,
  };

  // (Opcional mas útil) “marca” o evento com taskId no Google
  if (taskId) {
    body.extendedProperties = { private: { taskId } };
  }

  // Com horário -> evento 1h
  if (deadlineTime && /^\d{2}:\d{2}$/.test(deadlineTime)) {
    const startDateTime = `${startDateIso}T${deadlineTime}:00-03:00`;
    const start = new Date(startDateTime);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    body.start = { dateTime: start.toISOString(), timeZone: SAO_PAULO_TZ };
    body.end = { dateTime: end.toISOString(), timeZone: SAO_PAULO_TZ };
  } else {
    // all-day (end.date é exclusivo -> dia seguinte)
    body.start = { date: startDateIso };
    body.end = { date: addOneDay(startDateIso) };
  }

  if (attendeeEmails?.length) {
    body.attendees = attendeeEmails.map((email) => ({ email }));
  }

  return body;
}

async function calendarFetch(args: {
  method: "POST" | "PATCH" | "DELETE";
  calendarId: string;
  eventId?: string;
  body?: any;
}) {
  const accessToken = await getGoogleAccessToken();

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    args.calendarId
  )}/events`;

  const url = new URL(args.eventId ? `${base}/${encodeURIComponent(args.eventId)}` : base);
  url.searchParams.set("sendUpdates", SEND_UPDATES);

  const res = await fetch(url.toString(), {
    method: args.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });

  const raw = await res.text();
  return { ok: res.ok, status: res.status, raw };
}

/**
 * Cria evento “cru” e devolve {eventId, htmlLink}
 */
export async function createCalendarEventForTask(taskId: string) {
  const calendarId = mustEnv("GOOGLE_CALENDAR_ID");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      deadlineTime: true,
      delegationEmail: true,
      responsibleEmail: true,
      carbonCopies: { select: { email: true } },
    },
  });

  if (!task?.term) return null;

  const dateIso = toDateIsoFromTerm(task.term);
  const attendeeEmails = uniqueEmails([
    task.responsibleEmail,
    task.delegationEmail,
    ...task.carbonCopies.map((c) => c.email),
  ]);

  const body = buildEventBody({
    summary: `FTA • ${task.title}`,
    description: task.description ?? undefined,
    startDateIso: dateIso,
    deadlineTime: task.deadlineTime ?? null,
    attendeeEmails,
    taskId: task.id,
  });

  const { ok, status, raw } = await calendarFetch({ method: "POST", calendarId, body });
  if (!ok) throw new Error(`Calendar insert failed (${status}): ${raw}`);

  const json = JSON.parse(raw) as { id?: string; htmlLink?: string };
  return { eventId: json.id ?? null, htmlLink: json.htmlLink ?? null };
}

async function patchCalendarEvent(args: {
  calendarId: string;
  eventId: string;
  body: any;
}): Promise<{ eventId: string | null; htmlLink: string | null; status: number }> {
  const { ok, status, raw } = await calendarFetch({
    method: "PATCH",
    calendarId: args.calendarId,
    eventId: args.eventId,
    body: args.body,
  });

  if (!ok) {
    if (status === 404) return { eventId: null, htmlLink: null, status };
    throw new Error(`Calendar patch failed (${status}): ${raw}`);
  }

  const json = JSON.parse(raw) as { id?: string; htmlLink?: string };
  return { eventId: json.id ?? args.eventId, htmlLink: json.htmlLink ?? null, status };
}

async function deleteCalendarEvent(args: { calendarId: string; eventId: string }) {
  const { ok, status, raw } = await calendarFetch({
    method: "DELETE",
    calendarId: args.calendarId,
    eventId: args.eventId,
  });

  if (!ok && status !== 404) {
    throw new Error(`Calendar delete failed (${status}): ${raw}`);
  }
}

export async function deleteCalendarEventForTask(taskId: string) {
  const calendarId = mustEnv("GOOGLE_CALENDAR_ID");

  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, googleEventId: true },
  });

  if (!t?.googleEventId) return { deleted: false };

  await deleteCalendarEvent({ calendarId, eventId: t.googleEventId });

  await prisma.task.update({
    where: { id: taskId },
    data: { googleEventId: null, googleEventLink: null },
  });

  return { deleted: true };
}

/**
 * ✅ Anti-duplicação:
 * tenta “anexar” o eventId ao Task SOMENTE se o googleEventId ainda for o valor esperado.
 * Se perdeu a corrida, apaga o evento recém-criado.
 */
async function attachEventIdSafely(args: {
  taskId: string;
  expectedCurrentEventId: string | null; // null => só grava se ainda estiver null
  newEventId: string;
  newHtmlLink: string | null;
  calendarId: string;
}) {
  const { taskId, expectedCurrentEventId, newEventId, newHtmlLink, calendarId } = args;

  const where: any = { id: taskId };
  where.googleEventId = expectedCurrentEventId; // pode ser null ou string

  const res = await prisma.task.updateMany({
    where,
    data: { googleEventId: newEventId, googleEventLink: newHtmlLink ?? null },
  });

  if (res.count === 1) return { attached: true as const };

  // perdeu a corrida -> apaga o evento que você acabou de criar (evita duplicado)
  try {
    await deleteCalendarEvent({ calendarId, eventId: newEventId });
  } catch {
    // ignora
  }

  return { attached: false as const };
}

/**
 * ✅ Regra:
 * - status=done OU sem term -> remove evento (se existir)
 * - status!=done E tem term -> cria/atualiza evento
 *
 * ✅ Idempotente: mesmo que seja chamado 2x, não duplica mais.
 */
export async function syncCalendarEventForTask(taskId: string) {
  const calendarId = mustEnv("GOOGLE_CALENDAR_ID");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      term: true,
      deadlineTime: true,
      googleEventId: true,
      googleEventLink: true,
      delegationEmail: true,
      responsibleEmail: true,
      carbonCopies: { select: { email: true } },
    },
  });

  if (!task) return { action: "skipped" as const };

  const shouldHaveEvent = task.status !== "done" && !!task.term;

  // 1) não deveria ter evento -> apaga se existir
  if (!shouldHaveEvent) {
    if (task.googleEventId) {
      await deleteCalendarEvent({ calendarId, eventId: task.googleEventId });

      await prisma.task.update({
        where: { id: task.id },
        data: { googleEventId: null, googleEventLink: null },
      });

      return { action: "deleted" as const };
    }
    return { action: "skipped" as const };
  }

  // 2) deveria ter evento -> cria/atualiza
  const dateIso = toDateIsoFromTerm(task.term!);

  const attendeeEmails = uniqueEmails([
    task.responsibleEmail,
    task.delegationEmail, // ✅ delegador incluído (se tiver email salvo)
    ...task.carbonCopies.map((c) => c.email),
  ]);

  const body = buildEventBody({
    summary: `FTA • ${task.title}`,
    description: task.description ?? undefined,
    startDateIso: dateIso,
    deadlineTime: task.deadlineTime ?? null,
    attendeeEmails,
    taskId: task.id,
  });

  // 2a) já tem evento -> patch
  if (task.googleEventId) {
    const patched = await patchCalendarEvent({
      calendarId,
      eventId: task.googleEventId,
      body,
    });

    // se 404, recria (também protegido contra duplicação)
    if (!patched.eventId) {
      const created = await createCalendarEventForTask(task.id);
      if (created?.eventId) {
        const r = await attachEventIdSafely({
          taskId: task.id,
          expectedCurrentEventId: task.googleEventId, // só troca se ainda for o antigo
          newEventId: created.eventId,
          newHtmlLink: created.htmlLink ?? null,
          calendarId,
        });
        return r.attached
          ? { action: "created" as const, eventId: created.eventId }
          : { action: "skipped" as const };
      }
      return { action: "skipped" as const };
    }

    if (patched.htmlLink && patched.htmlLink !== task.googleEventLink) {
      await prisma.task.update({
        where: { id: task.id },
        data: { googleEventLink: patched.htmlLink },
      });
    }

    return { action: "updated" as const, eventId: patched.eventId };
  }

  // 2b) não tem evento -> cria (✅ protegido contra duplicação)
  const created = await createCalendarEventForTask(task.id);
  if (created?.eventId) {
    const r = await attachEventIdSafely({
      taskId: task.id,
      expectedCurrentEventId: null, // só grava se ainda estiver null
      newEventId: created.eventId,
      newHtmlLink: created.htmlLink ?? null,
      calendarId,
    });

    return r.attached
      ? { action: "created" as const, eventId: created.eventId }
      : { action: "skipped" as const };
  }

  return { action: "skipped" as const };
}
