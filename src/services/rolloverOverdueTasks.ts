// src/services/rolloverOverdueTasks.ts
import { prisma } from "../lib/prisma";

type MovedItem = {
  taskId: string;
  title: string;
  fromIso: string;
  toIso: string;
};

const SAO_PAULO_TZ = "America/Sao_Paulo";

// ✅ Horário de corte (20:00 SP)
const CUTOFF_HOUR = 11;
const CUTOFF_MINUTE = 55;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getSaoPauloParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  const iso = `${year}-${pad2(month)}-${pad2(day)}`; // YYYY-MM-DD no fuso SP
  return { year, month, day, hour, minute, iso };
}

function addDaysIso(iso: string, days: number) {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// ✅ grava sempre como 00:00 SP (03:00Z) pra não “shiftar” o dia
function saoPauloIsoToUtcDate(iso: string) {
  return new Date(`${iso}T03:00:00.000Z`);
}

export async function rolloverOverdueTasksForResponsible(args: { slackUserId: string }) {
  const { slackUserId } = args;

  const nowSp = getSaoPauloParts(new Date());
  const todayIso = nowSp.iso;

  const nowMinutes = nowSp.hour * 60 + nowSp.minute;
  const cutoffMinutes = CUTOFF_HOUR * 60 + CUTOFF_MINUTE;
  const afterCutoff = nowMinutes >= cutoffMinutes;

  // Pega todas as tasks abertas do responsável com prazo definido
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
    if (!t.term) continue;

    // ✅ compara o "dia" no fuso de SP (não UTC)
    const termSpIso = getSaoPauloParts(t.term).iso;

    // Regras:
    // 1) Se está ATRASADA (term < hoje):
    //    - antes do cutoff: move para HOJE
    //    - depois do cutoff: move para AMANHÃ
    if (termSpIso < todayIso) {
      const toIso = afterCutoff ? addDaysIso(todayIso, 1) : todayIso;

      await prisma.task.update({
        where: { id: t.id },
        data: { term: saoPauloIsoToUtcDate(toIso) },
      });

      moved.push({ taskId: t.id, title: t.title, fromIso: termSpIso, toIso });
      continue;
    }

    // 2) Se é PARA HOJE (term == hoje) e passou do cutoff:
    //    - move para AMANHÃ
    if (termSpIso === todayIso && afterCutoff) {
      const toIso = addDaysIso(todayIso, 1);

      await prisma.task.update({
        where: { id: t.id },
        data: { term: saoPauloIsoToUtcDate(toIso) },
      });

      moved.push({ taskId: t.id, title: t.title, fromIso: termSpIso, toIso });
      continue;
    }

    // 3) Futuras: não mexe
  }

  return { moved };
}
