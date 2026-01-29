// src/services/createTaskService.ts
import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";
import { Recurrence } from "../generated/prisma/enums";

const SP_TZ = "America/Sao_Paulo";
const SP_OFFSET_HOURS = 3; // SP é UTC-3 (sem DST atualmente)

// YYYY-MM-DD -> salva como 00:00 SP (== 03:00Z)
function dateIsoToSpMidnightUtc(dateIso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const d = new Date(`${dateIso}T03:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (term === null || term === undefined) return null;

  // Caso venha como "YYYY-MM-DD"
  if (typeof term === "string") {
    const sp = dateIsoToSpMidnightUtc(term);
    if (sp) return sp;

    // fallback p/ outros formatos
    const d = new Date(term);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (term instanceof Date) {
    if (Number.isNaN(term.getTime())) return null;

    // Se foi criado por new Date("YYYY-MM-DD"), normalmente vira 00:00Z
    // Aí em SP vira dia anterior. Corrigimos pra 03:00Z.
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

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ? data.description.trim() : null,

      delegation: data.delegation,
      responsible: data.responsible,

      term,
      deadlineTime: data.deadlineTime ?? null,
      recurrence,
      projectId: data.projectId ?? null,

      recurrenceAnchor: recurrence ? term : null,

      urgency: data.urgency,
      status: "pending",

      ...(data.carbonCopies.length
        ? {
            carbonCopies: {
              createMany: { data: data.carbonCopies.map((id) => ({ slackUserId: id })) },
            },
          }
        : {}),
    },
    include: { carbonCopies: true },
  });

  return task;
}
