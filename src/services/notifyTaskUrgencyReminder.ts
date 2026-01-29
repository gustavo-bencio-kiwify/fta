// src/services/notifyTaskUrgencyReminder.ts
import type { WebClient } from "@slack/web-api";

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

export async function notifyTaskUrgencyReminder(args: {
  slack: WebClient;
  responsibleSlackId: string;
  dateIso: string; // YYYY-MM-DD (SP)
  slot: string;    // ex: "L_10:00"
  tasks: Array<{ title: string; deadlineTime?: string | null }>;
}) {
  const { slack, responsibleSlackId, dateIso, tasks } = args;
  if (!tasks.length) return;

  const channel = await openDm(slack, responsibleSlackId);

  const header = `⏰ Lembrete (${fmtDatePt(dateIso)}): você tem ${tasks.length} tarefa(s) pendente(s).`;

  const lines = tasks.slice(0, 20).map((t) => {
    const time = t.deadlineTime ? ` às *${t.deadlineTime}*` : "";
    return `• *${t.title}*${time}`;
  });

  const suffix = tasks.length > 20 ? `\n… +${tasks.length - 20} tarefa(s).` : "";

  await slack.chat.postMessage({
    channel,
    text: `${header}\n${lines.join("\n")}${suffix}`,
  });
}
