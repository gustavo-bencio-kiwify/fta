// src/services/notifyTasksReplanned.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

type ReplannedItem = {
  taskId: string;     // ✅ novo
  taskTitle: string;
  fromIso: string; // YYYY-MM-DD
  toIso: string;   // YYYY-MM-DD
};

function formatPtBr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

async function openDmChannel(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel (DM)");
  return channelId;
}

export async function notifyTasksReplanned(args: {
  slack: WebClient;
  responsibleSlackId: string;
  items: ReplannedItem[];
}) {
  const { slack, responsibleSlackId, items } = args;
  if (!items.length) return;

  for (const it of items) {
    const from = formatPtBr(it.fromIso);
    const to = formatPtBr(it.toIso);
    const text = `🔁 *${it.taskTitle}*: prazo mudou de *${from}* para *${to}*.`;

    // ✅ tenta postar na thread da abertura
    const task = await prisma.task.findUnique({
      where: { id: it.taskId },
      select: { slackOpenChannelId: true, slackOpenMessageTs: true },
    });

    if (task?.slackOpenChannelId && task?.slackOpenMessageTs) {
      await slack.chat.postMessage({
        channel: task.slackOpenChannelId,
        text,
        thread_ts: task.slackOpenMessageTs,
      });
      continue;
    }

    // fallback: DM direto (caso task antiga sem campos)
    const channel = await openDmChannel(slack, responsibleSlackId);
    await slack.chat.postMessage({ channel, text });
  }
}
