// src/services/notifyTaskUrgencyReminder.ts
import type { WebClient } from "@slack/web-api";

/**
 * ✅ Reminders devem ir como reply na *thread* da mensagem de abertura da task
 * (root message enviada em notifyTaskCreated).
 *
 * Este arquivo NÃO usa conversations.history / conversations.replies, então NÃO
 * exige scopes *:history.
 */

const dmCache = new Map<string, { channelId: string; ts: number }>();
const DM_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h

async function openDm(slack: WebClient, userId: string) {
  const cached = dmCache.get(userId);
  if (cached && Date.now() - cached.ts < DM_CACHE_TTL_MS) return cached.channelId;

  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");

  dmCache.set(userId, { channelId, ts: Date.now() });
  return channelId;
}

function fmtDatePt(iso: string) {
  // iso: YYYY-MM-DD
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function mention(id: string) {
  return `<@${id}>`;
}

export type ReminderTask = {
  id: string;
  title: string;
  responsibleSlackId: string;
  deadlineTime?: string | null;

  // thread da abertura (root message enviada no notifyTaskCreated)
  slackOpenChannelId: string | null;
  slackOpenMessageTs: string | null;
};

export async function notifyTaskUrgencyReminder(args: {
  slack: WebClient;
  dateIso: string; // YYYY-MM-DD (SP)
  slot: string; // ex: "TURBO_09:00" / "ASAP_12:00" / "LIGHT_16:00" (pra log/dedup)
  task: ReminderTask;
}) {
  const { slack, dateIso, task } = args;

  const time = task.deadlineTime ? ` às *${task.deadlineTime}*` : "";
  const text = `⏰ ${mention(task.responsibleSlackId)} lembrete (${fmtDatePt(dateIso)}): *${task.title}* ainda está pendente.${time}`;

  // ✅ Preferência: postar dentro da thread da abertura
  if (task.slackOpenChannelId && task.slackOpenMessageTs) {
    await slack.chat.postMessage({
      channel: task.slackOpenChannelId,
      thread_ts: task.slackOpenMessageTs,
      text,
      reply_broadcast: false,
    });
    return;
  }

  // Fallback: manda DM "solta" (pra não perder lembrete)
  const channel = await openDm(slack, task.responsibleSlackId);
  await slack.chat.postMessage({ channel, text });
}
