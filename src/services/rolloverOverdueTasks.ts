// src/services/rolloverOverdueTasks.ts
import { prisma } from "../lib/prisma";

const SAO_PAULO_TZ = "America/Sao_Paulo";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getSaoPauloNowParts(now = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  const dateIso = `${year}-${pad2(month)}-${pad2(day)}`; // YYYY-MM-DD (SP)
  const timeStr = `${pad2(hour)}:${pad2(minute)}`;       // HH:MM

  return { dateIso, hour, minute, timeStr };
}

function addDaysIso(iso: string, days: number) {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function termIso(term: Date | null) {
  if (!term || Number.isNaN(term.getTime())) return null;
  return term.toISOString().slice(0, 10);
}

/**
 * Move tasks "atrasadas" para o dia seguinte, mantendo o mesmo horário.
 * Regra:
 * - Só roda após 20:00 em America/Sao_Paulo.
 * - Tasks de dias anteriores: sempre vão para amanhã.
 * - Tasks de hoje: só vão para amanhã se deadlineTime for null OU deadlineTime <= horário atual (HH:MM).
 */
export async function rolloverOverdueTasksForResponsible(responsibleSlackId: string) {
  const { dateIso: todayIso, hour, timeStr } = getSaoPauloNowParts();

  // ✅ Só reprograma após 20h GMT-3
  if (hour < 20) {
    return { ran: false, updated: 0, todayIso, moved: [] as Array<{ taskTitle: string; fromIso: string; toIso: string }> };
  }

  const tomorrowIso = addDaysIso(todayIso, 1);

  const todayUtc = new Date(`${todayIso}T00:00:00.000Z`);
  const tomorrowUtc = new Date(`${tomorrowIso}T00:00:00.000Z`);

  const moved = await prisma.$transaction(async (tx) => {
    // 1) pegar tasks de dias anteriores
    const prevDayTasks = await tx.task.findMany({
      where: {
        responsible: responsibleSlackId,
        status: { not: "done" },
        term: { lt: todayUtc },
      },
      select: { id: true, title: true, term: true },
    });

    // 2) pegar tasks de hoje (com horário já passado OU sem horário)
    const todayTasks = await tx.task.findMany({
      where: {
        responsible: responsibleSlackId,
        status: { not: "done" },
        term: { gte: todayUtc, lt: tomorrowUtc },
        OR: [{ deadlineTime: null }, { deadlineTime: { lte: timeStr } }],
      },
      select: { id: true, title: true, term: true },
    });

    const toMove = [...prevDayTasks, ...todayTasks];

    if (!toMove.length) return [];

    // 3) atualiza em lote (todas para amanhã)
    await tx.task.updateMany({
      where: { id: { in: toMove.map((t) => t.id) } },
      data: { term: tomorrowUtc },
    });

    // 4) retorna “de -> para” para notificação
    return toMove
      .map((t) => {
        const fromIso = termIso(t.term);
        if (!fromIso) return null;
        return { taskTitle: t.title, fromIso, toIso: tomorrowIso };
      })
      .filter(Boolean) as Array<{ taskTitle: string; fromIso: string; toIso: string }>;
  });

  return {
    ran: true,
    updated: moved.length,
    todayIso,
    tomorrowIso,
    cutoffTime: timeStr,
    moved,
  };
}
