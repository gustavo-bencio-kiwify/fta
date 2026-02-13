// src/services/updateTaskService.ts
import { prisma } from "../lib/prisma";
import { syncCalendarEventForTask } from "./googleCalendar";

function toSaoPauloMidnightDate(termIso: string) {
  // iso: YYYY-MM-DD
  // 00:00 SP => 03:00Z (considerando SP -03)
  return new Date(`${termIso}T03:00:00.000Z`);
}

/**
 * Recurrence no banco é enum.
 * Aqui tratamos como string vinda do modal.
 * - "none" / "" / null => null
 * - qualquer outro valor => set
 */
function normalizeRecurrence(input: string | null): string | null {
  const v = (input ?? "").trim();
  if (!v || v === "none") return null;
  return v;
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
  recurrenceAnchor: true,
  urgency: true,
  calendarPrivate: true,
  createdAt: true,
  carbonCopies: { select: { slackUserId: true } },
} as const;

type TaskSelected = {
  id: string;
  title: string;
  description: string | null;
  delegation: string;
  responsible: string;
  term: Date | null;
  deadlineTime: string | null;
  recurrence: any;
  recurrenceAnchor: Date | null;
  urgency: any;
  calendarPrivate: boolean;
  createdAt: Date;
  carbonCopies: { slackUserId: string }[];
};

type TaskSnapshot = {
  id: string;
  title: string;
  description: string | null;
  delegation: string;
  responsible: string;
  term: Date | null;
  deadlineTime: string | null;
  recurrence: string | null;
  urgency: string;
  calendarPrivate: boolean;
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
    calendarPrivate: Boolean((t as any).calendarPrivate ?? false),
    createdAt: t.createdAt,
    carbonCopies: (t.carbonCopies ?? []).map((c) => c.slackUserId),
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

  urgency: "light" | "asap" | "turbo" | string;
  calendarPrivate: boolean;
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
    urgency,
    calendarPrivate,
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
  const recurrenceValue = normalizeRecurrence(recurrence);

  const afterRaw = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: title.trim(),
      description: description?.trim() ? description.trim() : null,
      term: newTerm,
      deadlineTime: newTime,

      responsible: responsibleSlackId,
      recurrence: recurrenceValue as any,

      urgency: (urgency as any) ?? "light",
      calendarPrivate: Boolean(calendarPrivate),

      // ✅ mantém regra: se recorrente, ancora no term; se não, null
      recurrenceAnchor: recurrenceValue ? newTerm : null,

      // 🔁 substitui CCs
      carbonCopies: {
        deleteMany: {},
        create: newCc.map((slackUserId: string) => ({ slackUserId })),
      },
    },
    select: TASK_SELECT,
  });

  const after = afterRaw as unknown as TaskSelected;

  // ✅ sync do calendário (não bloqueia a resposta do Slack)
  void syncCalendarEventForTask(taskId).catch((e) => {
    console.error("[calendar] sync failed (updateTaskService):", taskId, e);
  });

  return {
    before: toSnapshot(before),
    after: toSnapshot(after),
  };
}
