// src/services/createTaskService.ts
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

  // ✅ aqui está o fix: nunca mandar null pro banco
  const description = (data.description ?? "").trim();

  try {
    const task = await prisma.task.create({
      data: {
        title: data.title,
        description, // ✅ sempre string
        delegation: data.delegation,
        responsible: data.responsible,
        term,
        urgency: data.urgency,
        recurrence: data.recurrence ?? "none",

        ...(data.carbonCopies?.length
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
  } catch (err) {
    console.error("[createTaskService] prisma error:", err);
    throw err; // deixa o interactive registrar também
  }
}
