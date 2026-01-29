// src/services/rescheduleTaskService.ts
import { prisma } from "../lib/prisma";

/**
 * Salva a data como "meio-dia UTC" do dia escolhido.
 * Isso impede o problema do Brasil (UTC-3) de aparecer como dia anterior.
 */
function normalizeTermFromIso(dateIso: string | null | undefined): Date | null {
  if (!dateIso) return null;

  // YYYY-MM-DD -> 12:00Z
  const d = new Date(`${dateIso}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function rescheduleTaskService(args: {
  taskId: string;
  requesterSlackId: string; // quem clicou

  newDateIso: string; // YYYY-MM-DD
  newTime?: string | null; // "HH:MM" | null
}) {
  const term = normalizeTermFromIso(args.newDateIso);

  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      responsible: true,
      delegation: true,
      term: true,
      deadlineTime: true,
    },
  });

  if (!task) throw new Error("Task not found");

  // responsável OU delegador podem reprogramar
  const can = task.responsible === args.requesterSlackId || task.delegation === args.requesterSlackId;
  if (!can) throw new Error("Not allowed");

  const updated = await prisma.task.update({
    where: { id: args.taskId },
    data: {
      term,
      deadlineTime: args.newTime?.trim() ? args.newTime.trim() : null,
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

  return { before: task, after: updated };
}
