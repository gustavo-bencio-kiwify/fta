// src/services/completeTasksService.ts
import { prisma } from "../lib/prisma";
import { Recurrence } from "../generated/prisma/enums";

// ✅ padrão Brasil (SP) pra evitar -1 dia (UTC 00:00 vira dia anterior)
const SAFE_UTC_HOUR = 3;

function toSafeUtcDateFromIso(dateIso: string): Date {
  // dateIso: YYYY-MM-DD
  return new Date(`${dateIso}T${String(SAFE_UTC_HOUR).padStart(2, "0")}:00:00.000Z`);
}

function toIsoFromDateUTC(d: Date): string {
  // pega a data "do dia" em UTC
  return d.toISOString().slice(0, 10);
}

function addMonthsClampedUTC(date: Date, months: number): Date {
  // trabalha só com componentes UTC (evita timezone drift)
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonth = m + months;
  const firstOfTarget = new Date(Date.UTC(y, targetMonth, 1, SAFE_UTC_HOUR, 0, 0));
  const lastDayTargetMonth = new Date(Date.UTC(y, targetMonth + 1, 0, SAFE_UTC_HOUR, 0, 0)).getUTCDate();

  const clampedDay = Math.min(day, lastDayTargetMonth);
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), clampedDay, SAFE_UTC_HOUR, 0, 0));
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function nextTermFromRecurrence(base: Date, recurrence: Recurrence): Date {
  switch (recurrence) {
    case "daily":
      return addDaysUTC(base, 1);
    case "weekly":
      return addDaysUTC(base, 7);
    case "biweekly":
      return addDaysUTC(base, 14);
    case "monthly":
      return addMonthsClampedUTC(base, 1);
    case "quarterly":
      return addMonthsClampedUTC(base, 3);
    case "semiannual":
      return addMonthsClampedUTC(base, 6);
    case "annual":
      return addMonthsClampedUTC(base, 12);
    default:
      return base;
  }
}

export async function completeTasksService(args: {
  taskIds: string[];
  requesterSlackId: string; // quem clicou (aqui seu fluxo exige responsável)
}) {
  const ids = Array.from(new Set((args.taskIds ?? []).filter(Boolean)));

  if (!ids.length) {
    return { doneTasks: [], rolledTasks: [] };
  }

  // busca as tasks que realmente podem ser concluídas (responsável = requester)
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: ids },
      responsible: args.requesterSlackId,
      status: { not: "done" },
    },
    select: {
      id: true,
      title: true,
      description: true,
      responsible: true,
      delegation: true,
      term: true,
      deadlineTime: true,
      recurrence: true,
      recurrenceAnchor: true,
      urgency: true,
      projectId: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (!tasks.length) {
    return { doneTasks: [], rolledTasks: [] };
  }

  const doneTasks: typeof tasks = [];
  const rolledTasks: typeof tasks = [];

  await prisma.$transaction(async (tx) => {
    for (const t of tasks) {
      const recurrence = t.recurrence as Recurrence | null;

      // ✅ não recorrente -> vira done
      if (!recurrence) {
        await tx.task.update({
          where: { id: t.id },
          data: { status: "done" },
        });
        doneTasks.push(t);
        continue;
      }

      // ✅ recorrente -> NÃO vira done: rola para próxima data
      // base: preferimos anchor; se não tiver, usa term; se nada, usa "hoje"
      const base = t.recurrenceAnchor ?? t.term ?? toSafeUtcDateFromIso(toIsoFromDateUTC(new Date()));

      const next = nextTermFromRecurrence(base, recurrence);
      const nextIso = toIsoFromDateUTC(next);
      const nextSafeDate = toSafeUtcDateFromIso(nextIso);

      await tx.task.update({
        where: { id: t.id },
        data: {
          // mantém pendente e move a data
          status: "pending",
          term: nextSafeDate,

          // regra do anchor: anchor sempre aponta para a "data original" desta instância
          recurrenceAnchor: nextSafeDate,
        },
      });

      rolledTasks.push(t);
    }
  });

  return { doneTasks, rolledTasks };
}
