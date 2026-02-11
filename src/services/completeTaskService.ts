// src/services/completeTasksService.ts
import { prisma } from "../lib/prisma";
import { Recurrence } from "../generated/prisma/enums";
import { syncCalendarEventForTask } from "./googleCalendar";

const SAFE_UTC_HOUR = 3;

function toSafeUtcDateFromIso(dateIso: string): Date {
  return new Date(`${dateIso}T${String(SAFE_UTC_HOUR).padStart(2, "0")}:00:00.000Z`);
}

function toIsoFromDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
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

export async function completeTasksService(args: {
  taskIds: string[];
  requesterSlackId: string;
}) {
  const ids = Array.from(new Set((args.taskIds ?? []).filter(Boolean)));
  if (!ids.length) return { doneTasks: [], rolledTasks: [] };

  const tasks = await prisma.task.findMany({
    where: {
      id: { in: ids },
      responsible: args.requesterSlackId,
      status: { not: "done" },
    },
    select: {
      id: true,
      title: true,
      term: true,
      deadlineTime: true,
      recurrence: true,
      recurrenceAnchor: true,
    },
  });

  if (!tasks.length) return { doneTasks: [], rolledTasks: [] };

  const doneIds: string[] = [];
  const rolledIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const t of tasks) {
      const recurrence = t.recurrence as Recurrence | null;

      if (!recurrence) {
        await tx.task.update({ where: { id: t.id }, data: { status: "done" } });
        doneIds.push(t.id);
        continue;
      }

      const base = t.recurrenceAnchor ?? t.term ?? toSafeUtcDateFromIso(toIsoFromDateUTC(new Date()));
      const next = nextTermFromRecurrence(base, recurrence);
      const nextIso = toIsoFromDateUTC(next);
      const nextSafeDate = toSafeUtcDateFromIso(nextIso);

      await tx.task.update({
        where: { id: t.id },
        data: {
          status: "pending",
          term: nextSafeDate,
          recurrenceAnchor: nextSafeDate,
        },
      });

      rolledIds.push(t.id);
    }
  });

  // ✅ sync calendário depois do commit
  void Promise.allSettled([...doneIds, ...rolledIds].map((id) => syncCalendarEventForTask(id))).catch(() => {});

  return { doneTasks: doneIds, rolledTasks: rolledIds };
}
