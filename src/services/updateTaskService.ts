// src/services/updateTaskService.ts
import { prisma } from "../lib/prisma";

function toSaoPauloMidnightDate(termIso: string) {
  // iso: YYYY-MM-DD
  // 00:00 SP => 03:00Z (considerando SP -03)
  return new Date(`${termIso}T03:00:00.000Z`);
}

/**
 * Recurrence no banco é enum.
 * Aqui tratamos como string vinda do modal.
 * - "none" / "" / null => null
 * - qualquer outro valor => set (cast como any pra não brigar com enum types)
 */
function buildRecurrenceUpdate(input: string | null) {
  const v = (input ?? "").trim();
  if (!v || v === "none") return null;
  return { set: v as any } as any;
}

/**
 * ✅ Select fixo => TS infere corretamente `carbonCopies`
 */
const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  delegation: true,
  responsible: true,
  term: true,
  deadlineTime: true,
  recurrence: true,
  urgency: true,
  createdAt: true,
  carbonCopies: { select: { slackUserId: true } },
} as const;

type TaskSelected = {
  id: string;
  title: string;
  description: string | null;
  delegation: string | null;
  responsible: string;
  term: Date | null;
  deadlineTime: string | null;
  recurrence: any;
  urgency: any;
  createdAt: Date;
  carbonCopies: { slackUserId: string }[];
};

type TaskSnapshot = {
  id: string;
  title: string;
  description: string | null;
  delegation: string | null;
  responsible: string;
  term: Date | null;
  deadlineTime: string | null;
  recurrence: string | null;
  urgency: string;
  createdAt: Date;
  carbonCopies: string[];
};

function toSnapshot(t: TaskSelected): TaskSnapshot {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    responsible: t.responsible,
    term: t.term,
    deadlineTime: t.deadlineTime ?? null,
    recurrence: t.recurrence ? String(t.recurrence) : null,
    urgency: t.urgency ? String(t.urgency) : "light",
    createdAt: t.createdAt,
    carbonCopies: (t.carbonCopies ?? []).map((c: { slackUserId: string }) => c.slackUserId),
  };
}

export async function updateTaskService(args: {
  taskId: string;
  delegationSlackId: string;

  title: string;
  description: string | null;

  termIso: string | null; // YYYY-MM-DD
  deadlineTime: string | null; // HH:MM | null

  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
  recurrence: string | null;
}) {
  const {
    taskId,
    delegationSlackId,
    title,
    description,
    termIso,
    deadlineTime,
    responsibleSlackId,
    carbonCopiesSlackIds,
    recurrence,
  } = args;

  const beforeRaw = await prisma.task.findUnique({
    where: { id: taskId },
    select: TASK_SELECT,
  });

  const before = beforeRaw as unknown as TaskSelected | null;

  if (!before) throw new Error(`Task not found: ${taskId}`);
  if (before.delegation !== delegationSlackId) throw new Error("Not allowed to edit this task");

  const newTerm = termIso ? toSaoPauloMidnightDate(termIso) : null;
  const newTime = deadlineTime?.trim() ? deadlineTime.trim() : null;

  const newCc = Array.from(new Set((carbonCopiesSlackIds ?? []).filter(Boolean)));
  const recurrenceUpdate = buildRecurrenceUpdate(recurrence);

  const afterRaw = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: title.trim(),
      description: description?.trim() ? description.trim() : null,
      term: newTerm,
      deadlineTime: newTime,

      responsible: responsibleSlackId,
      recurrence: recurrenceUpdate as any,

      // 🔁 substitui CCs
      carbonCopies: {
        deleteMany: {},
        create: newCc.map((slackUserId: string) => ({ slackUserId })),
      },
    },
    select: TASK_SELECT,
  });

  const after = afterRaw as unknown as TaskSelected;

  return {
    before: toSnapshot(before),
    after: toSnapshot(after),
  };
}
