// src/services/updateTaskService.ts
import { prisma } from "../lib/prisma";

function normalizeTermFromIsoDate(iso?: string | null) {
  if (!iso) return null;
  // iso: YYYY-MM-DD (vindo do datepicker)
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function updateTaskService(args: {
  taskId: string;
  delegationSlackId: string;

  // PATCH (somente campos editáveis neste modal)
  title: string;
  description?: string | null;
  termIso?: string | null;        // "YYYY-MM-DD" | null  (opcional)
  deadlineTime?: string | null;   // "HH:MM" | null (opcional)
}) {
  const existing = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      deadlineTime: true,

      delegation: true,
      responsible: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (!existing) throw new Error("Task not found");
  if (existing.delegation !== args.delegationSlackId) throw new Error("Not allowed");

  const term = args.termIso !== undefined ? normalizeTermFromIsoDate(args.termIso) : undefined;
  const deadlineTime =
    args.deadlineTime !== undefined ? (args.deadlineTime?.trim() ? args.deadlineTime.trim() : null) : undefined;

  const updated = await prisma.task.update({
    where: { id: args.taskId },
    data: {
      // só muda se vier
      title: args.title.trim(),
      description: args.description?.trim() ? args.description.trim() : null,

      ...(term !== undefined ? { term } : {}),
      ...(deadlineTime !== undefined ? { deadlineTime } : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      deadlineTime: true,

      delegation: true,
      responsible: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  return {
    before: {
      title: existing.title,
      responsible: existing.responsible,
      carbonCopies: existing.carbonCopies.map((c) => c.slackUserId),
    },
    after: {
      title: updated.title,
      responsible: updated.responsible,
      carbonCopies: updated.carbonCopies.map((c) => c.slackUserId),
    },
  };
}
