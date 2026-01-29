// src/integrations/googleCalendar.ts
import { google } from "googleapis";

const CALENDAR_ID =
  "c_c8fb270e421c8ec189fce7bc82048bd47a0f263368748746bbd312ad3850307b@group.calendar.google.com";

const SAO_PAULO_TZ = "America/Sao_Paulo";

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
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

function toAllDayEndExclusive(dateIso: string) {
  // end.date é exclusivo -> dia seguinte
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CreateTaskCalendarEventArgs = {
  summary: string;
  description?: string | null;

  // data no formato "YYYY-MM-DD"
  dateIso: string;

  // "HH:MM" (se existir, cria evento de 1h; se não, all-day)
  timeHHmm?: string | null;

  // convidados
  guestEmails: string[];
};

export async function createEventOnTasksCalendar(args: CreateTaskCalendarEventArgs) {
  const clientId = assertEnv("GOOGLE_CLIENT_ID");
  const clientSecret = assertEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = assertEnv("GOOGLE_REDIRECT_URI");
  const refreshToken = assertEnv("GOOGLE_REFRESH_TOKEN");

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: "v3", auth });

  const attendeeEmails = uniqueEmails(args.guestEmails);
  const attendees = attendeeEmails.map((email) => ({ email }));

  const description = (args.description ?? "").trim() || undefined;

  // Caso COM horário -> 1h
  if (args.timeHHmm && args.timeHHmm.trim()) {
    const startLocal = new Date(`${args.dateIso}T${args.timeHHmm}:00`);
    const endLocal = addHours(startLocal, 1);

    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: "all",
      requestBody: {
        summary: args.summary,
        description,
        start: { dateTime: startLocal.toISOString(), timeZone: SAO_PAULO_TZ },
        end: { dateTime: endLocal.toISOString(), timeZone: SAO_PAULO_TZ },
        attendees,
      },
    });

    return { eventId: res.data.id ?? null, htmlLink: res.data.htmlLink ?? null };
  }

  // Caso SEM horário -> all-day
  const endExclusive = toAllDayEndExclusive(args.dateIso);

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    sendUpdates: "all",
    requestBody: {
      summary: args.summary,
      description,
      start: { date: args.dateIso },
      end: { date: endExclusive },
      attendees,
    },
  });

  return { eventId: res.data.id ?? null, htmlLink: res.data.htmlLink ?? null };
}
