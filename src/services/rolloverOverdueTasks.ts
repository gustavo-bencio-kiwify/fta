// src/services/rolloverOverdueTasks.ts
import { prisma } from "../lib/prisma";

type MovedItem = {
  taskId: string;      // ✅ novo
  title: string;
  fromIso: string;
  toIso: string;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

export async function rolloverOverdueTasksForResponsible(args: { slackUserId: string }) {
  const { slackUserId } = args;

  const todaySp = new Date();
  const todayIso = isoDate(todaySp);

  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "done" },
      responsible: slackUserId,
      term: { not: null },
    },
    select: { id: true, title: true, term: true },
    take: 500,
  });

  const moved: MovedItem[] = [];

  for (const t of tasks) {
    const termIso = t.term ? isoDate(t.term) : null;
    if (!termIso) continue;

    if (termIso < todayIso) {
      const newTerm = addDays(todaySp, 1);
      const fromIso = termIso;
      const toIso = isoDate(newTerm);

      await prisma.task.update({
        where: { id: t.id },
        data: { term: new Date(`${toIso}T03:00:00.000Z`) },
      });

      moved.push({
        taskId: t.id,      // ✅ novo
        title: t.title,
        fromIso,
        toIso,
      });
    }
  }

  return { moved };
}
