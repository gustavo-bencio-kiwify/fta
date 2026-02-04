// src/jobs/turboUrgencyReminderCron.ts
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
 * Turbo: roda a cada 30min (09:00..18:00), só deixa passar se estiver na janela.
 */
function isWithinTurboWindow(hour: number, minute: number) {
  const total = hour * 60 + minute;
  const start = 9 * 60;   // 09:00
  const end = 18 * 60;    // 18:00 (inclui 18:00, exclui 18:30)

  const isHalfHour = minute === 0 || minute === 30;
  return isHalfHour && total >= start && total <= end;
}

export async function runTurboUrgencyReminderCron() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");

  const slack = new WebClient(token);

  const { dateIso, hour, minute } = getSaoPauloNowParts(new Date());

  const force = process.env.FORCE_TURBO_REMINDER === "1";
  if (!force && !isWithinTurboWindow(hour, minute)) {
    console.log(`[turbo-reminder] outside window: ${dateIso} ${pad2(hour)}:${pad2(minute)} (SP)`);
    return;
  }

  const slot = `TURBO_${pad2(hour)}:${pad2(minute)}`;

  const startUtc = saoPauloMidnightUtc(dateIso);
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);

  // Turbo lembra tarefas pendentes "até hoje" (overdue + hoje).
  const turboTasks = await prisma.task.findMany({
    where: {
      status: { not: "done" },
      urgency: "turbo" as any, // se seu schema tiver enum Urgency, dá pra tipar melhor
      term: { not: null, lt: endUtc },
      // ✅ evita duplicar lembrete (por dateIso + slot)
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

  if (!turboTasks.length) {
    console.log(`[turbo-reminder] no turbo tasks for ${dateIso}`);
    return;
  }

  console.log(
    `[turbo-reminder] sending reminders: ${turboTasks.length} tasks • slot=${slot} • date=${dateIso}`
  );

  // ✅ 1 reminder por task (cada task tem uma thread diferente)
  await Promise.allSettled(
    turboTasks.map(async (t) => {
      // cria log ANTES (evita duplicar em multi-instância)
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
        // se falhou enviar, remove log para permitir retry em execução futura
        if (logId) {
          await prisma.taskReminderLog.delete({ where: { id: logId } }).catch(() => void 0);
        }
        throw err;
      }
    })
  );
}

// CLI entry
if (require.main === module) {
  runTurboUrgencyReminderCron()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("[turbo-reminder] failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
