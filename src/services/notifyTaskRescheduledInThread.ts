import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

function formatPtBr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function mention(userId: string) {
  return `<@${userId}>`;
}

export async function notifyTaskRescheduledInThread(args: {
  slack: WebClient;
  taskId: string;
  fromIso: string; // YYYY-MM-DD
  toIso: string;   // YYYY-MM-DD
  changedBySlackId: string; // quem reprogramou (responsável)
}) {
  const { slack, taskId, fromIso, toIso, changedBySlackId } = args;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  if (!task?.slackOpenChannelId || !task?.slackOpenMessageTs) {
    // sem mensagem principal registrada -> não tem thread pra postar
    return;
  }

  const text =
    `📅 Prazo reprogramado por ${mention(changedBySlackId)}: ` +
    `*${task.title}* de *${formatPtBr(fromIso)}* para *${formatPtBr(toIso)}*.`;

  await slack.chat.postMessage({
    channel: task.slackOpenChannelId,
    text,
    thread_ts: task.slackOpenMessageTs,
  });
}
