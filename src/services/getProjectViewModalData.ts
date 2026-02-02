// src/services/getProjectViewModalData.ts
import { prisma } from "../lib/prisma";
import type { ProjectModalFilter } from "../views/projectViewModal";

// ✅ Use SEMPRE os tipos gerados no seu output custom:
import type { TaskWhereInput } from "../generated/prisma/models/Task";

export const PROJECT_MODAL_PAGE_SIZE = 6;

// ✅ sua enum é string-union; usar literal funciona com o tipo
const STATUS_DONE = "done" as const;

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

export async function getProjectViewModalData(args: {
  slackUserId: string;
  projectId: string;
  page: number;
  filter: ProjectModalFilter;
}) {
  const { slackUserId, projectId, page, filter } = args;

  // 1) valida se o usuário é membro do projeto
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "active",
      members: { some: { slackUserId } },
    },
    select: { id: true, name: true },
  });

  if (!project) return null;

  const todayStart = startOfTodayUtc();

  // ✅ TaskWhereInput do SEU client gerado
  const baseWhere: TaskWhereInput = { projectId: project.id };

  // 2) stats
  const [openCount, doneCount, overdueCount] = await Promise.all([
    prisma.task.count({
      where: { ...baseWhere, status: { not: STATUS_DONE } },
    }),
    prisma.task.count({
      where: { ...baseWhere, status: STATUS_DONE },
    }),
    prisma.task.count({
      where: {
        ...baseWhere,
        status: { not: STATUS_DONE },
        term: { not: null, lt: todayStart },
      },
    }),
  ]);

  // 3) filtro (também do tipo TaskWhereInput)
  let filterWhere: TaskWhereInput = {};
  if (filter === "pendentes") filterWhere = { status: { not: STATUS_DONE } };
  if (filter === "concluidas") filterWhere = { status: STATUS_DONE };

  // 4) paginação
  const totalFiltered = await prisma.task.count({
    where: { ...baseWhere, ...filterWhere },
  });

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PROJECT_MODAL_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const tasks = await prisma.task.findMany({
    where: { ...baseWhere, ...filterWhere },
    orderBy: [{ createdAt: "desc" }],
    skip: (safePage - 1) * PROJECT_MODAL_PAGE_SIZE,
    take: PROJECT_MODAL_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      responsible: true,
      term: true,
      status: true,
    },
  });

  return {
    project: { id: project.id, name: project.name },
    stats: { open: openCount, done: doneCount, overdue: overdueCount },
    tasks,
    page: safePage,
    totalPages,
    filter,
  };
}
