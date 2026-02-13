// src/jobs/pruneDoneTasksCron.ts
import cron from "node-cron";
import { prisma } from "../lib/prisma";

export async function pruneDoneTasks(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const oldDone = await prisma.task.findMany({
    where: { status: "done", updatedAt: { lt: cutoff } },
    select: { id: true },
    take: 10000,
  });

  const ids = oldDone.map((t) => t.id);
  if (!ids.length) return { deleted: 0 };

  const deleted = await prisma.$transaction(async (tx) => {
    // evita erro de FK (dependências apontando pra tasks deletadas)
    await tx.task.updateMany({
      where: { dependsOnId: { in: ids } },
      data: { dependsOnId: null },
    });

    // se já tiver cascade no schema, isso é redundante (mas é seguro)
    await tx.taskCarbonCopy.deleteMany({ where: { taskId: { in: ids } } });

    const del = await tx.task.deleteMany({ where: { id: { in: ids } } });
    return del.count;
  });

  return { deleted };
}

export function startPruneDoneTasksCron(opts?: {
  cronExpr?: string;
  timezone?: string;
  days?: number;
  runOnBoot?: boolean;
}) {
  const cronExpr = opts?.cronExpr ?? "10 3 * * *"; // 03:10 todo dia
  const timezone = opts?.timezone ?? "America/Sao_Paulo";
  const days = opts?.days ?? 7;
  const runOnBoot = opts?.runOnBoot ?? false;

  if (runOnBoot) {
    void pruneDoneTasks(days)
      .then((r) => console.log(`[prune] boot run deleted=${r.deleted}`))
      .catch((e) => console.error("[prune] boot run failed:", e));
  }

  cron.schedule(
    cronExpr,
    () => {
      void pruneDoneTasks(days)
        .then((r) => console.log(`[prune] deleted=${r.deleted}`))
        .catch((e) => console.error("[prune] failed:", e));
    },
    { timezone }
  );

  console.log(`[prune] scheduled cron="${cronExpr}" tz="${timezone}" days=${days}`);
}
