// src/services/createNextRecurringTaskFromCompleted.ts
import { prisma } from "../lib/prisma";
import { Recurrence } from "../generated/prisma/enums";
import { syncCalendarEventForTask } from "./googleCalendar";

const SAFE_UTC_HOUR = 3;

function toIsoFromDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toSafeUtcDateFromIso(dateIso: string): Date {
  return new Date(`${dateIso}T${String(SAFE_UTC_HOUR).padStart(2, "0")}:00:00.000Z`);
}

function addMonthsClampedUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonth = m + months;
  const firstOfTarget = new Date(Date.UTC(y, targetMonth, 1, SAFE_UTC_HOUR, 0, 0));
  const lastDayTargetMonth = new Date(Date.UTC(y, targetMonth + 1, 0, SAFE_UTC_HOUR, 0, 0)).getUTCDate();

  const clampedDay = Math.min(day, lastDayTargetMonth);
  return new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), clampedDay, SAFE_UTC_HOUR, 0, 0)
  );
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function nextTermFromRecurrence(base: Date, recurrence: Recurrence): Date {
  switch (recurrence) {
    case "daily":
      return addDaysUTC(base, 1);
    case "weekly":
      return addDaysUTC(base, 7);
    case "biweekly":
      return addDaysUTC(base, 14);
    case "monthly":
      return addMonthsClampedUTC(base, 1);
    case "quarterly":
      return addMonthsClampedUTC(base, 3);
    case "semiannual":
      return addMonthsClampedUTC(base, 6);
    case "annual":
      return addMonthsClampedUTC(base, 12);
    default:
      return base;
  }
}

export async function createNextRecurringTaskFromCompleted(args: { completedTaskId: string }) {
  const completed = await prisma.task.findUnique({
    where: { id: args.completedTaskId },
    select: {
      id: true,
      title: true,
      description: true,
      delegation: true,
      delegationEmail: true,
      responsible: true,
      responsibleEmail: true,
      term: true,
      deadlineTime: true,
      recurrence: true,
      projectId: true,
      dependsOnId: true,
      urgency: true,
      calendarPrivate: true,
      carbonCopies: { select: { slackUserId: true, email: true } },
    },
  });

  if (!completed?.recurrence) return null;

  const recurrence = completed.recurrence as Recurrence;

  // base: se a task tinha term, usa; senão usa "hoje"
  const base = completed.term ?? toSafeUtcDateFromIso(toIsoFromDateUTC(new Date()));
  const next = nextTermFromRecurrence(base, recurrence);

  const nextIso = toIsoFromDateUTC(next);
  const nextSafeDate = toSafeUtcDateFromIso(nextIso);

  // ✅ Anti-duplicação:
  // se já existe uma próxima instância com a mesma recurrenceAnchor, não cria outra.
  const existing = await prisma.task.findFirst({
    where: {
      status: { not: "done" },
      recurrence: completed.recurrence as any,
      recurrenceAnchor: nextSafeDate,
      responsible: completed.responsible,
      title: completed.title,
      projectId: completed.projectId ?? null,
      // se quiser ficar ainda mais preciso, pode descomentar:
      // delegation: completed.delegation ?? null,
    },
    select: {
      id: true,
      title: true,
      term: true,
      deadlineTime: true,
      responsible: true,
      delegation: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      term: existing.term ?? null,
      deadlineTime: existing.deadlineTime ?? null,
      responsible: existing.responsible,
      delegation: existing.delegation ?? null,
      carbonCopiesSlackIds: existing.carbonCopies.map((c) => c.slackUserId),
    };
  }

  const nextTask = await prisma.task.create({
    data: {
      title: completed.title,
      description: completed.description,
      delegation: completed.delegation ?? null,
      delegationEmail: completed.delegationEmail ?? null,
      responsible: completed.responsible,
      responsibleEmail: completed.responsibleEmail ?? null,

      term: nextSafeDate,
      deadlineTime: completed.deadlineTime ?? null,

      status: "pending",
      recurrence: completed.recurrence as any,
      recurrenceAnchor: nextSafeDate,

      urgency: completed.urgency as any,
      projectId: completed.projectId ?? null,
      dependsOnId: completed.dependsOnId ?? null,

      calendarPrivate: (completed as any).calendarPrivate ?? false,

      carbonCopies: completed.carbonCopies.length
        ? {
            createMany: {
              data: completed.carbonCopies.map((c) => ({
                slackUserId: c.slackUserId,
                email: c.email ?? null,
              })),
              skipDuplicates: true,
            },
          }
        : undefined,
    },
    select: {
      id: true,
      title: true,
      term: true,
      deadlineTime: true,
      responsible: true,
      delegation: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  // calendário do novo
  void syncCalendarEventForTask(nextTask.id).catch((e) => {
    console.error("[calendar] failed to create/sync event for next recurring task:", nextTask.id, e);
  });

  return {
    id: nextTask.id,
    title: nextTask.title,
    term: nextTask.term ?? null,
    deadlineTime: nextTask.deadlineTime ?? null,
    responsible: nextTask.responsible,
    delegation: nextTask.delegation ?? null,
    carbonCopiesSlackIds: nextTask.carbonCopies.map((c) => c.slackUserId),
  };
}
