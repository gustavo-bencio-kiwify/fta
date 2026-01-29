// src/services/notifyTasksReplanned.ts
import type { WebClient } from "@slack/web-api";

type ReplannedItem = {
  taskTitle: string;
  fromIso: string; // YYYY-MM-DD
  toIso: string;   // YYYY-MM-DD
};

function formatPtBr(iso: string) {
  // iso = YYYY-MM-DD
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

  const lines = items.map((it) => {
    const from = formatPtBr(it.fromIso);
    const to = formatPtBr(it.toIso);
    return `🔁 *${it.taskTitle}*: prazo mudou de *${from}* para *${to}*.`;
  });

  const text = lines.join("\n");

  const channel = await openDmChannel(slack, responsibleSlackId);
  await slack.chat.postMessage({ channel, text });
}
