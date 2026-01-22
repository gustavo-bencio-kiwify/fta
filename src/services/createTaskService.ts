// src/services/createTaskService.ts
import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";
import { Recurrence } from "../generated/prisma/enums"; // ajuste o path se necessário

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (term === null || term === undefined) return null;

  // Já veio Date
  if (term instanceof Date) {
    return Number.isNaN(term.getTime()) ? null : term;
  }

  // Veio como "YYYY-MM-DD"
  if (typeof term === "string") {
    const d = new Date(term);
    return Number.isNaN(d.getTime()) ? null : d;
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
    "none", // existe no seu enum, mas o modal não oferece
  ];

  if (typeof r === "string" && (allowed as string[]).includes(r)) return r as Recurrence;

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

      urgency: data.urgency,
      status: "pending",

      ...(data.carbonCopies.length
        ? {
            carbonCopies: {
              createMany: {
                data: data.carbonCopies.map((id) => ({
                  slackUserId: id,
                })),
              },
            },
          }
        : {}),
    },
    include: { carbonCopies: true },
  });

  return task;
}
