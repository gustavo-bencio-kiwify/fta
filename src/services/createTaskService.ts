import { prisma } from "../lib/prisma";
import { createTaskSchema, type CreateTaskInput } from "../schema/taskSchema";

function normalizeTerm(term: CreateTaskInput["term"]) {
  // aceita: undefined | null | "" | Date | string
  if (term === undefined || term === null || term === "") return null;

  if (term instanceof Date) {
    return Number.isNaN(term.getTime()) ? null : term;
  }

  if (typeof term === "string") {
    const d = new Date(term);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export async function createTaskService(raw: unknown) {
  try {
    const data = createTaskSchema.parse(raw);

    const term = normalizeTerm(data.term);

    console.log("[createTaskService] parsed:", {
      title: data.title,
      hasDescription: !!data.description,
      delegation: data.delegation,
      responsible: data.responsible,
      term,
      urgency: data.urgency,
      carbonCopiesCount: data.carbonCopies?.length ?? 0,
    });

    const task = await prisma.task.create({
      data: {
        title: data.title,
        // garante null no banco quando não tiver descrição
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

    console.log("[createTaskService] created:", { id: task.id });

    return task;
  } catch (err: any) {
    console.error("[createTaskService] ERROR:", err);
    throw err;
  }
}
