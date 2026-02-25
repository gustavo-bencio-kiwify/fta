// src/services/updateTaskService.ts
import { prisma } from "../lib/prisma";
import { syncCalendarEventForTask } from "./googleCalendar";

function toSaoPauloMidnightDate(termIso: string) {
  // YYYY-MM-DD -> 00:00 SP (≈ 03:00Z)
  return new Date(`${termIso}T03:00:00.000Z`);
}

function normalizeRecurrence(input: string | null): string | null {
  const v = (input ?? "").trim();
  if (!v || v === "none") return null;
  return v;
}

function normalizeProjectId(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v || v === "none" || v === "null") return null;
  return v;
}

function normalizeUrgency(input: string | null | undefined): "light" | "asap" | "turbo" {
  const v = String(input ?? "light").trim().toLowerCase();
  if (v === "asap" || v === "turbo" || v === "light") return v;
  return "light";
}

/**
 * ✅ Select fixo => TS infere corretamente
 * ✅ Inclui projectId para diff/notificações
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
  projectId: true, // ✅ NOVO
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
  recurrenceAnchor: Date | null;
  urgency: any;
  calendarPrivate: boolean;
  projectId: string | null; // ✅ NOVO
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
  calendarPrivate: boolean;
  projectId: string | null; // ✅ NOVO
  createdAt: Date;
  carbonCopies: string[];
};

function toSnapshot(t: TaskSelected): TaskSnapshot {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation ?? null,
    responsible: t.responsible,
    term: t.term,
    deadlineTime: t.deadlineTime ?? null,
    recurrence: t.recurrence ? String(t.recurrence) : null,
    urgency: t.urgency ? String(t.urgency) : "light",
    calendarPrivate: Boolean(t.calendarPrivate ?? false),
    projectId: t.projectId ?? null, // ✅ NOVO
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

  // ✅ NOVO: projeto (null = sem projeto)
  projectId: string | null;
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
    projectId,
  } = args;

  // -------------------------
  // Validações básicas
  // -------------------------
  const trimmedTitle = (title ?? "").trim();
  if (!trimmedTitle) throw new Error("Title is required");

  const trimmedResponsible = (responsibleSlackId ?? "").trim();
  if (!trimmedResponsible) throw new Error("Responsible user is required");

  const recurrenceValue = normalizeRecurrence(recurrence);
  const urgencyValue = normalizeUrgency(urgency);
  const normalizedProjectId = normalizeProjectId(projectId);

  const newTerm = termIso ? toSaoPauloMidnightDate(termIso) : null;
  const newTime = deadlineTime?.trim() ? deadlineTime.trim() : null;

  const newCc = Array.from(new Set((carbonCopiesSlackIds ?? []).filter(Boolean).map((v) => String(v).trim())))
    .filter(Boolean);

  // -------------------------
  // Busca task atual + permissão
  // -------------------------
  const beforeRaw = await prisma.task.findUnique({
    where: { id: taskId },
    select: TASK_SELECT,
  });

  const before = beforeRaw as unknown as TaskSelected | null;

  if (!before) throw new Error(`Task not found: ${taskId}`);
  if ((before.delegation ?? null) !== delegationSlackId) {
    throw new Error("Not allowed to edit this task");
  }

  // -------------------------
  // Valida projeto (se informado)
  // -------------------------
  if (normalizedProjectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: normalizedProjectId,
        status: "active",
      },
      select: { id: true },
    });

    if (!project) {
      throw new Error("Invalid or inactive project");
    }
  }

  // -------------------------
  // Update (atômico)
  // -------------------------
  const afterRaw = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: trimmedTitle,
      description: description?.trim() ? description.trim() : null,

      term: newTerm,
      deadlineTime: newTime,

      responsible: trimmedResponsible,
      recurrence: recurrenceValue as any,

      urgency: urgencyValue as any,
      calendarPrivate: Boolean(calendarPrivate),

      // ✅ NOVO: vínculo de projeto
      projectId: normalizedProjectId,

      // ✅ regra de recorrência: ancora no prazo se houver recorrência
      recurrenceAnchor: recurrenceValue ? newTerm : null,

      // 🔁 substitui CCs
      carbonCopies: {
        deleteMany: {},
        create: newCc.map((slackUserId) => ({ slackUserId })),
      },
    },
    select: TASK_SELECT,
  });

  const after = afterRaw as unknown as TaskSelected;

  // ✅ sync do calendário (fire-and-forget)
  void syncCalendarEventForTask(taskId).catch((e) => {
    console.error("[calendar] sync failed (updateTaskService):", taskId, e);
  });

  return {
    before: toSnapshot(before),
    after: toSnapshot(after),
  };
}