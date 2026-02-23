// src/services/openQuestionThread.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

async function openGroupDm(slack: WebClient, userIds: string[]) {
  const users = uniq(userIds);

  // Slack exige string "Uxxx,Uyyy,..."
  const conv = await slack.conversations.open({ users: users.join(",") });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM/MPIM channel");
  return channelId;
}

export async function openQuestionThread(args: {
  slack: WebClient;
  taskId: string;
  requestedBy: string; // quem clicou no botão
}) {
  const { slack, taskId, requestedBy } = args;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      delegation: true,
      responsible: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (!task) throw new Error(`Task not found: ${taskId}`);

  const cc = task.carbonCopies.map((c) => c.slackUserId);

  const participants = uniq([requestedBy, task.delegation, task.responsible, ...cc]);
  const mentions = participants.map((id) => `<@${id}>`).join(", ");

  const channelId = await openGroupDm(slack, participants);

  const header = `:thread: Thread sobre *${task.title}*.`;
  const meta = `UID: \`${task.id}\``;

  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "context", elements: [{ type: "mrkdwn", text: meta }] },
  ];

  // mensagem “raiz” => cria a thread
  const msg = await slack.chat.postMessage({
    channel: channelId,
    text: `Thread aberta por <@${requestedBy}>`,
    blocks,
  });

  // ✅ mensagem dentro da thread
  if (msg.ts) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: msg.ts,
      text:`:speech_balloon: *:thread: Converse entre: *${mentions}`,
    });
  }

  return { channelId, ts: msg.ts };
}
