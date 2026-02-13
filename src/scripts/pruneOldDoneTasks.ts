// src/scripts/pruneOldDoneTasks.ts
import { prisma } from "../lib/prisma";

const DAYS = 7;

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  const oldDone = await prisma.task.findMany({
    where: { status: "done", updatedAt: { lt: cutoff } },
    select: { id: true },
    take: 5000, // evita explodir memória se tiver muita coisa
  });

  const ids = oldDone.map((t) => t.id);
  if (!ids.length) {
    console.log(`[prune] nothing to delete (cutoff=${cutoff.toISOString()})`);
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // solta dependências antes (evita erro de FK)
    await tx.task.updateMany({
      where: { dependsOnId: { in: ids } },
      data: { dependsOnId: null },
    });

    // cascades já removem TaskCarbonCopy e TaskReminderLog (onDelete: Cascade)
    const del = await tx.task.deleteMany({
      where: { id: { in: ids } },
    });

    return del.count;
  });

  console.log(`[prune] deleted ${result} done tasks older than ${DAYS} days`);
}

main()
  .catch((e) => {
    console.error("[prune] failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
