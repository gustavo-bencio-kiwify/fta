// src/services/createTaskService.ts
import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (!term) return null;

  // se já veio Date
  if (term instanceof Date && !Number.isNaN(term.getTime())) return term;

  // se veio "YYYY-MM-DD" (Slack datepicker)
  if (typeof term === "string") {
    const d = new Date(term); // vira UTC midnight
    if (!Number.isNaN(d.getTime()) && d.getTime() !== 0) return d;
  }

  return null;
}

export async function createTaskService(raw: unknown) {
  const data = createTaskSchema.parse(raw);
  const term = normalizeTerm(data.term);

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      delegation: data.delegation,
      responsible: data.responsible,
      term,
      urgency: data.urgency,
      recurrence: data.recurrence ?? "none",
      ...(data.carbonCopies.length
        ? {
            carbonCopies: {
              createMany: {
                data: data.carbonCopies.map((id) => ({ slackUserId: id })),
              },
            },
          }
        : {}),
    },
    include: { carbonCopies: true },
  });

  return task;
}
