// src/services/taskReminderScheduler.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { notifyTaskUrgencyReminder } from "./notifyTaskUrgencyReminder";

const SAO_PAULO_TZ = "America/Sao_Paulo";

let started = false;

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

  const dateIso = `${year}-${pad2(month)}-${pad2(day)}`; // YYYY-MM-DD
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;

  return { dateIso, hour, minute, hhmm };
}

function buildUtcDayRange(dateIso: string) {
  const start = new Date(`${dateIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function getSlotNow(): { slot: string; urgency: "light" | "asap" | "turbo" }[] {
  const { hour, minute, hhmm } = getSaoPauloNowParts();

  // Light: 10:00 e 16:00
  if (hhmm === "10:00") return [{ slot: "L_10:00", urgency: "light" }, { slot: "A_10:00", urgency: "asap" }, { slot: "T_10:00", urgency: "turbo" }];
  if (hhmm === "12:00") return [{ slot: "A_12:00", urgency: "asap" }, { slot: "T_12:00", urgency: "turbo" }];
  if (hhmm === "16:00") return [{ slot: "L_16:00", urgency: "light" }, { slot: "A_16:00", urgency: "asap" }, { slot: "T_16:00", urgency: "turbo" }];

  // Turbo: a cada 30 min (10:00 até 20:00)
  const isTurboWindow = hour >= 10 && hour <= 20;
  const isHalfHour = minute === 0 || minute === 30;

  if (isTurboWindow && isHalfHour) {
    return [{ slot: `T_${hhmm}`, urgency: "turbo" }];
  }

  return [];
}

async function tick(slack: WebClient) {
  const { dateIso } = getSaoPauloNowParts();
  const slots = getSlotNow();
  if (!slots.length) return;

  const { start, end } = buildUtcDayRange(dateIso);

  // Processa slot por slot
  for (const s of slots) {
    // 1) Busca tasks pendentes de HOJE (SP) daquela urgência
    const tasks = await prisma.task.findMany({
      where: {
        status: { not: "done" },
        urgency: s.urgency,
        term: { gte: start, lt: end },
      },
      select: {
        id: true,
        title: true,
        deadlineTime: true,
        responsible: true,
      },
    });

    if (!tasks.length) continue;

    // 2) Filtra quem já recebeu lembrete nesse slot (idempotente)
    const already = await prisma.taskReminderLog.findMany({
      where: {
        dateIso,
        slot: s.slot,
        taskId: { in: tasks.map((t) => t.id) },
      },
      select: { taskId: true },
    });

    const alreadySet = new Set(already.map((x) => x.taskId));
    const toNotify = tasks.filter((t) => !alreadySet.has(t.id));

    if (!toNotify.length) continue;

    // 3) Cria logs (antes de enviar) — robusto contra duplicação
    await prisma.taskReminderLog.createMany({
      data: toNotify.map((t) => ({
        taskId: t.id,
        dateIso,
        slot: s.slot,
      })),
      skipDuplicates: true,
    });

    // 4) Agrupa por responsável e manda 1 DM por responsável
    const byResponsible = new Map<string, Array<{ title: string; deadlineTime?: string | null }>>();

    for (const t of toNotify) {
      const arr = byResponsible.get(t.responsible) ?? [];
      arr.push({ title: t.title, deadlineTime: t.deadlineTime });
      byResponsible.set(t.responsible, arr);
    }

    await Promise.allSettled(
      Array.from(byResponsible.entries()).map(([responsibleSlackId, items]) =>
        notifyTaskUrgencyReminder({
          slack,
          responsibleSlackId,
          dateIso,
          slot: s.slot,
          tasks: items,
        })
      )
    );
  }
}

export function startTaskReminderScheduler(slack: WebClient) {
  if (started) return;
  started = true;

  // roda a cada 60s (simples e sem dependência externa)
  setInterval(() => {
    tick(slack).catch((e) => console.error("[taskReminderScheduler] tick error:", e));
  }, 60_000);

  // opcional: roda uma vez no boot (não spamma pq só dispara em slot válido)
  tick(slack).catch((e) => console.error("[taskReminderScheduler] boot tick error:", e));

  console.log("[taskReminderScheduler] started");
}
