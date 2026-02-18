// src/jobs/cutoffRolloverCron.ts
import { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

import { rolloverOverdueTasksForResponsible } from "../services/rolloverOverdueTasks";
import { notifyTasksReplanned } from "../services/notifyTaskReplanned";
import { updateTaskOpenMessage } from "../services/updateTaskOpenMessage";
import { publishHome } from "../services/publishHome";
import { syncCalendarEventForTask } from "../services/googleCalendar"; // ✅ NOVO

const SAO_PAULO_TZ = "America/Sao_Paulo";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getSaoPauloTodayIso(now = new Date()) {
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

  return `${year}-${pad2(month)}-${pad2(day)}`; // YYYY-MM-DD
}

function addDaysIso(iso: string, days: number) {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// ✅ grava sempre como 00:00 SP (03:00Z)
function saoPauloIsoToUtcDate(iso: string) {
  return new Date(`${iso}T03:00:00.000Z`);
}

export async function runCutoffRolloverCron() {
  const slack = new WebClient(mustEnv("SLACK_BOT_TOKEN"));

  const todayIso = getSaoPauloTodayIso(new Date());
  const tomorrowIso = addDaysIso(todayIso, 1);
  const tomorrowUtc = saoPauloIsoToUtcDate(tomorrowIso);

  // ✅ Só roda para quem tem task com prazo <= hoje (term < amanhã 00:00 SP)
  const responsibles = await prisma.task.findMany({
    where: {
      status: { not: "done" },
      term: { not: null, lt: tomorrowUtc },
    },
    select: { responsible: true },
    distinct: ["responsible"],
  });

  for (const r of responsibles) {
    const responsibleSlackId = r.responsible;
    if (!responsibleSlackId) continue;

    const result = await rolloverOverdueTasksForResponsible({ slackUserId: responsibleSlackId });
    if (!result?.moved?.length) continue;

    // ✅ Notifica que reprogramou (thread da msg principal ou DM fallback)
    try {
      await notifyTasksReplanned({
        slack,
        responsibleSlackId,
        items: result.moved.map((m) => ({
          taskId: String(m.taskId ?? ""),
          taskTitle: m.title ?? "",
          fromIso: m.fromIso,
          toIso: m.toIso,
        })),
      });
    } catch (e) {
      console.error("[cutoffRolloverCron] notifyTasksReplanned failed:", responsibleSlackId, e);
    }

    // ✅ Atualiza msg principal + ✅ atualiza/move evento do Google Calendar
    for (const t of result.moved) {
      try {
        await updateTaskOpenMessage(slack, t.taskId);
      } catch (e) {
        console.error("[cutoffRolloverCron] updateTaskOpenMessage failed:", t.taskId, e);
      }

      try {
        // ✅ isso faz PATCH do evento existente (ou recria se 404)
        await syncCalendarEventForTask(t.taskId);
      } catch (e) {
        console.error("[cutoffRolloverCron] syncCalendarEventForTask failed:", t.taskId, e);
      }
    }

    // ✅ Atualiza Home do responsável (pra task “sumir/mudar” na hora)
    try {
      await publishHome(slack, responsibleSlackId);
    } catch (e) {
      console.error("[cutoffRolloverCron] publishHome failed:", responsibleSlackId, e);
    }
  }
}
