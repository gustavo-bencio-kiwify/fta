// src/jobs/lightUrgencyReminderCron.ts
import { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { notifyTaskUrgencyReminder } from "../services/notifyTaskUrgencyReminder";

const SAO_PAULO_TZ = "America/Sao_Paulo";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Retorna data ISO YYYY-MM-DD e hora/minuto atuais em SP.
 */
function getSaoPauloNowParts(now = new Date()): {
  dateIso: string;
  hour: number;
  minute: number;
} {
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

  return {
    dateIso: `${year}-${pad2(month)}-${pad2(day)}`,
    hour,
    minute,
  };
}

/**
 * 00:00 SP => 03:00Z (SP -03)
 */
function saoPauloMidnightUtc(dateIso: string) {
  return new Date(`${dateIso}T03:00:00.000Z`);
}

/**
 * Light: dispara SOMENTE às 10:00 e 16:00 (SP)
 */
function isLightSlot(hour: number, minute: number) {
  if (minute !== 0) return false;
  return hour === 10 || hour === 16;
}

export async function runLightUrgencyReminderCron() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");

  const slack = new WebClient(token);

  const { dateIso, hour, minute } = getSaoPauloNowParts(new Date());

  const force = process.env.FORCE_LIGHT_REMINDER === "1";
  if (!force && !isLightSlot(hour, minute)) {
    console.log(`[light-reminder] outside slot: ${dateIso} ${pad2(hour)}:${pad2(minute)} (SP)`);
    return;
  }

  const slot = `LIGHT_${pad2(hour)}:${pad2(minute)}`;

  const startUtc = saoPauloMidnightUtc(dateIso);
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);

  // Light lembra tarefas pendentes "até hoje" (overdue + hoje).
  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "done" },
      urgency: "light" as any,
      term: { not: null, lt: endUtc },
      // ✅ evita duplicar (mesmo slot no mesmo dia)
      reminders: { none: { dateIso, slot } },
    },
    select: {
      id: true,
      title: true,
      deadlineTime: true,
      responsible: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  if (!tasks.length) {
    console.log(`[light-reminder] no light tasks for ${dateIso} • slot=${slot}`);
    return;
  }

  console.log(`[light-reminder] sending reminders: ${tasks.length} tasks • slot=${slot} • date=${dateIso}`);

  await Promise.allSettled(
    tasks.map(async (t) => {
      // ✅ cria log para evitar duplicação (em múltiplas instâncias)
      let logId: string | null = null;
      try {
        const log = await prisma.taskReminderLog.create({
          data: { taskId: t.id, dateIso, slot },
          select: { id: true },
        });
        logId = log.id;
      } catch (e: any) {
        // P2002 = unique constraint (já lembrou)
        if (e?.code === "P2002") return;
        throw e;
      }

      try {
        await notifyTaskUrgencyReminder({
          slack,
          dateIso,
          slot,
          task: {
            id: t.id,
            title: t.title,
            responsibleSlackId: t.responsible,
            deadlineTime: t.deadlineTime ?? null,
            slackOpenChannelId: t.slackOpenChannelId,
            slackOpenMessageTs: t.slackOpenMessageTs,
          },
        });
      } catch (err) {
        // se falhar envio, remove o log para permitir retry
        if (logId) {
          await prisma.taskReminderLog.delete({ where: { id: logId } }).catch(() => {});
        }
        throw err;
      }
    })
  );
}

// CLI entry
if (require.main === module) {
  runLightUrgencyReminderCron()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("[light-reminder] failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
