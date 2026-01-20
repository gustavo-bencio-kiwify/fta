import { prisma } from "../lib/prisma";
import { createTaskSchema, CreateTaskInput } from "../schema/taskSchema";

function normalizeTerm(term: CreateTaskInput["term"]) {
  if (!term) return null;
  if (term instanceof Date && !Number.isNaN(term.getTime())) return term;
  return null;
}

export async function createTaskService(raw: unknown) {
  const data = createTaskSchema.parse(raw);
  const term = normalizeTerm(data.term);
   const description =
    typeof data.description === "string" && data.description.trim() !== ""
      ? data.description.trim()
      : null;

  console.log("[createTaskService] input:", {
    title: data.title,
    delegation: data.delegation,
    responsible: data.responsible,
    term,
    urgency: data.urgency,
    carbonCopiesCount: data.carbonCopies.length,
  });

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description,
      delegation: data.delegation,
      responsible: data.responsible,
      term,
      urgency: data.urgency,
      recurrence: data.recurrence ?? "none",

      // ✅ só cria CC se tiver algo
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

  console.log("[createTaskService] created task:", task.id);

  return task;
}
