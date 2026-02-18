// src/services/rolloverOverdueTasks.ts
import { prisma } from "../lib/prisma";

type MovedItem = {
  taskId: string;
  title: string;
  fromIso: string;
  toIso: string;
};

const SAO_PAULO_TZ = "America/Sao_Paulo";

// ✅ Horário de corte
const CUTOFF_HOUR = 11;
const CUTOFF_MINUTE = 55;

// =========================================================
// ✅ FERIADOS (API) — apenas nacionais/federais
// BrasilAPI: https://brasilapi.com.br/api/feriados/v1/{ano}
// =========================================================
const HOLIDAYS_API_BASE = "https://brasilapi.com.br/api/feriados/v1";

// cache por ano (pra não bater na API toda hora)
const holidayCache = new Map<number, Set<string>>();

type BrasilApiHoliday = {
  date: string; // "YYYY-MM-DD"
  name: string;
  type: string; // "national" (em geral)
};

async function getHolidaySetForYear(year: number): Promise<Set<string>> {
  if (holidayCache.has(year)) return holidayCache.get(year)!;

  try {
    const res = await fetch(`${HOLIDAYS_API_BASE}/${year}`, {
      headers: { "accept": "application/json" },
    });

    if (!res.ok) throw new Error(`Holidays API ${res.status}`);

    const data = (await res.json()) as BrasilApiHoliday[];

    // por segurança, guarda só YYYY-MM-DD válidos
    const set = new Set<string>(
      (data ?? [])
        .map((h) => String(h?.date ?? "").trim())
        .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
    );

    holidayCache.set(year, set);
    return set;
  } catch (e) {
    // fallback: se API falhar, considera apenas fim de semana
    holidayCache.set(year, new Set());
    return holidayCache.get(year)!;
  }
}

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

function isWeekendIsoSp(iso: string) {
  // 00:00 SP = 03:00Z; usar getUTCDay mantém o “dia” certo do ISO SP
  const d = new Date(`${iso}T03:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 dom, 6 sáb
  return dow === 0 || dow === 6;
}

async function isHolidayIso(iso: string) {
  const year = Number(iso.slice(0, 4));
  const set = await getHolidaySetForYear(year);
  return set.has(iso);
}

/**
 * ✅ Retorna o mesmo dia se ele já for útil.
 * Senão, caminha até o próximo dia útil.
 */
async function rollToNextBusinessDayIso(fromIso: string): Promise<string> {
  let cur = fromIso;

  // limite hard pra não travar em caso de bug
  for (let i = 0; i < 40; i++) {
    if (!isWeekendIsoSp(cur) && !(await isHolidayIso(cur))) return cur;
    cur = addDaysIso(cur, 1);
  }

  // fallback extremo: devolve o original
  return fromIso;
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

  // ✅ calcula os alvos uma vez
  const todayBusinessIso = await rollToNextBusinessDayIso(todayIso);
  const nextBusinessIso = await rollToNextBusinessDayIso(addDaysIso(todayIso, 1));

  for (const t of tasks) {
    if (!t.term) continue;

    // ✅ compara o "dia" no fuso de SP (não UTC)
    const termSpIso = getSaoPauloParts(t.term).iso;

    // Regras:
    // 1) Se está ATRASADA (term < hoje):
    //    - antes do cutoff: move para HOJE (se hoje não for útil, vai pro próximo útil)
    //    - depois do cutoff: move para PRÓXIMO DIA ÚTIL (amanhã -> útil)
    if (termSpIso < todayIso) {
      const toIso = afterCutoff ? nextBusinessIso : todayBusinessIso;

      await prisma.task.update({
        where: { id: t.id },
        data: { term: saoPauloIsoToUtcDate(toIso) },
      });

      moved.push({ taskId: t.id, title: t.title, fromIso: termSpIso, toIso });
      continue;
    }

    // 2) Se é PARA HOJE (term == hoje) e passou do cutoff:
    //    - move para PRÓXIMO DIA ÚTIL
    if (termSpIso === todayIso && afterCutoff) {
      const toIso = nextBusinessIso;

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
