// src/services/createTaskService.ts
import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";
import { Recurrence } from "../generated/prisma/enums";
import { syncCalendarEventForTask } from "./googleCalendar";
import { getSlackUserEmail } from "./slackUserEmail";

const SP_OFFSET_HOURS = 3;

// YYYY-MM-DD -> salva como 00:00 SP (== 03:00Z)
function dateIsoToSpMidnightUtc(dateIso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const d = new Date(`${dateIso}T03:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (term === null || term === undefined) return null;

  if (typeof term === "string") {
    const sp = dateIsoToSpMidnightUtc(term);
    if (sp) return sp;

    const d = new Date(term);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (term instanceof Date) {
    if (Number.isNaN(term.getTime())) return null;

    const isUtcMidnight =
      term.getUTCHours() === 0 &&
      term.getUTCMinutes() === 0 &&
      term.getUTCSeconds() === 0 &&
      term.getUTCMilliseconds() === 0;

    if (isUtcMidnight) {
      return new Date(term.getTime() + SP_OFFSET_HOURS * 60 * 60 * 1000);
    }
    return term;
  }

  return null;
}

function normalizeRecurrence(r: unknown): Recurrence | null {
  if (r === null || r === undefined) return null;

  const allowed: Recurrence[] = [
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
    "none",
  ];

  if (typeof r === "string" && (allowed as string[]).includes(r)) {
    if (r === "none") return null;
    return r as Recurrence;
  }

  return null;
}

export async function createTaskService(raw: unknown) {
  const data = createTaskSchema.parse(raw);

  const term = normalizeTerm(data.term);
  const recurrence = normalizeRecurrence(data.recurrence);

  // ✅ busca emails no Slack antes de salvar (pra o Calendar pegar depois)
  const [delegationEmail, responsibleEmail] = await Promise.all([
    getSlackUserEmail(data.delegation).catch(() => null),
    getSlackUserEmail(data.responsible).catch(() => null),
  ]);

  const carbonCopiesData = await Promise.all(
    (data.carbonCopies ?? []).map(async (id) => ({
      slackUserId: id,
      email: await getSlackUserEmail(id).catch(() => null),
    }))
  );

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ? data.description.trim() : null,

      delegation: data.delegation,
      delegationEmail,

      responsible: data.responsible,
      responsibleEmail,

      term,
      deadlineTime: data.deadlineTime ?? null,
      recurrence,
      projectId: data.projectId ?? null,

      dependsOnId: data.dependsOnId ?? null,
      recurrenceAnchor: recurrence ? term : null,

      urgency: data.urgency,
      status: "pending",

      ...(carbonCopiesData.length
        ? {
          carbonCopies: {
            createMany: { data: carbonCopiesData },
          },
        }
        : {}),
    },
    include: { carbonCopies: true },
  });

  // ✅ cria evento no Google Calendar (não trava criação da task)
  // ✅ Calendar: cria/atualiza evento (não trava criação da task)
  if (task.term) {
    syncCalendarEventForTask(task.id).catch((e) => {
      console.error("[calendar] failed to sync after create:", task.id, e);
    });
  }
  return task;
}
