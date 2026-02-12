// src/services/markTaskOpenMessageAsCanceled.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";

export async function markTaskOpenMessageAsCanceled(args: {
  slack: WebClient;
  taskId: string;
  taskTitle?: string;
  canceledBySlackId?: string | null;
}) {
  const { slack, taskId, taskTitle, canceledBySlackId } = args;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  const title = task?.title ?? taskTitle ?? "tarefa";
  const channel = task?.slackOpenChannelId ?? null;
  const ts = task?.slackOpenMessageTs ?? null;

  // se não tem msg principal salva, não tem o que substituir
  if (!channel || !ts) return;

  const header = `❌ Task *${title}* cancelada`;

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${header}` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }],
    },
  ];

  try {
    await slack.chat.update({
      channel,
      ts,
      text: `❌ Task ${title} cancelada`,
      blocks, 
    });
  } catch {
    // ignora erros do Slack (mensagem não encontrada, permissões etc.)
  }
}
