// src/services/createTaskService.ts
import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";
import { Recurrence } from "../generated/prisma/enums"; // ajuste o path se necessário

function normalizeTerm(term: unknown): Date | null {
  if (term === null || term === undefined) return null;

  if (term instanceof Date) {
    return Number.isNaN(term.getTime()) ? null : term;
  }

  if (typeof term === "string") {
    if (term.trim() === "") return null; // ✅ agora não dá warning
    const d = new Date(term); // "YYYY-MM-DD"
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function normalizeRecurrence(r: unknown): Recurrence {
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

  if (typeof r === "string" && (allowed as string[]).includes(r)) return r as Recurrence;
  return "none";
}

type CarbonCopyInput = CreateTaskInput["carbonCopies"][number];

function normalizeCarbonCopies(carbonCopies: CreateTaskInput["carbonCopies"]) {
  return (carbonCopies ?? []).map((cc: CarbonCopyInput) => {
    if (typeof cc === "string") {
      return { slackUserId: cc, email: null as string | null };
    }
    return { slackUserId: cc.slackUserId, email: cc.email ?? null };
  });
}

export async function createTaskService(raw: unknown) {
  const data = createTaskSchema.parse(raw);

  const term = normalizeTerm(data.term);
  const recurrence = normalizeRecurrence(data.recurrence);

  const ccData = normalizeCarbonCopies(data.carbonCopies);

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ? data.description.trim() : null,
      delegation: data.delegation,
      responsible: data.responsible,
      term,
      urgency: data.urgency,
      recurrence, // ✅ enum

      status: "pending",

      ...(ccData.length
        ? {
            carbonCopies: {
              createMany: {
                data: ccData.map((x) => ({
                  slackUserId: x.slackUserId,
                  email: x.email,
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
