// src/services/rescheduleTaskService.ts
import { prisma } from "../lib/prisma";
import { syncCalendarEventForTask } from "./googleCalendar";

function toSaoPauloMidnightDate(termIso: string) {
  // YYYY-MM-DD -> 00:00 SP (== 03:00Z)
  const d = new Date(`${termIso}T03:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function rescheduleTaskService(args: {
  taskId: string;
  requesterSlackId: string; // quem clicou

  newDateIso: string; // YYYY-MM-DD
  newTime?: string | null; // "HH:MM" | null
}) {
  const term = toSaoPauloMidnightDate(args.newDateIso);

  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      responsible: true,
      delegation: true,
      term: true,
      deadlineTime: true,
      recurrence: true,
    },
  });

  if (!task) throw new Error("Task not found");

  const can = task.responsible === args.requesterSlackId || task.delegation === args.requesterSlackId;
  if (!can) throw new Error("Not allowed");

  const updated = await prisma.task.update({
    where: { id: args.taskId },
    data: {
      term,
      deadlineTime: args.newTime?.trim() ? args.newTime.trim() : null,

      // se for recorrente, mantém anchor alinhado
      recurrenceAnchor: task.recurrence ? term : null,
    },
    select: {
      id: true,
      title: true,
      responsible: true,
      delegation: true,
      term: true,
      deadlineTime: true,
    },
  });

  void syncCalendarEventForTask(args.taskId).catch((e) => {
    console.error("[calendar] sync failed (rescheduleTaskService):", args.taskId, e);
  });

  return { before: task, after: updated };
}
