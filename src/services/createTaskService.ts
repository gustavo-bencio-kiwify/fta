import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (!term) return null;

  if (term instanceof Date) return term;

  if (typeof term === "string") return new Date(term);

  return null;
}

export async function createTaskService(raw: unknown) {
  const data = createTaskSchema.parse(raw);

  const term = normalizeTerm(data.term);

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      delegation: data.delegation,
      responsible: data.responsible,
      term,
      urgency: data.urgency,
      recurrence: data.recurrence ?? "none",

      carbonCopies: {
        createMany: {
          data: (data.carbonCopies ?? []).map((id) => ({ slackUserId: id })),
        },
      },
    },
    include: { carbonCopies: true },
  });

  return task;
}
