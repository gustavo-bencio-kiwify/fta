// src/services/notifyTaskCompleted.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";

// ✅ exporta o action_id do botão "Reabrir"
export const TASK_REOPEN_ACTION_ID = "task_reopen" as const;

export async function notifyTaskCompleted(args: {
  slack: WebClient;
  taskId: string;
  completedBySlackId: string;
}) {
  const { slack, taskId, completedBySlackId } = args;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  if (!task) return;

  // ✅ Atualiza a mensagem de abertura (remove botões) e deixa "✅ Concluída"
  // Se você já tem isso em outro lugar, pode manter lá — mas aqui é o local ideal.
  if (task.slackOpenChannelId && task.slackOpenMessageTs) {
    const blocks: KnownBlock[] = [
      { type: "section", text: { type: "mrkdwn", text: `✅ *Concluída* por <@${completedBySlackId}>` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },
    ];

    // ✅ tenta substituir a mensagem raiz (remove actions)
    await slack.chat.update({
      channel: task.slackOpenChannelId,
      ts: task.slackOpenMessageTs,
      text: `✅ Concluída`,
      blocks,
    });
  }

  // ✅ Opcional: posta na thread um botão de reabrir
  if (task.slackOpenChannelId && task.slackOpenMessageTs) {
    await slack.chat.postMessage({
      channel: task.slackOpenChannelId,
      thread_ts: task.slackOpenMessageTs,
      text: `🧾 Tarefa concluída. Aqui você pode dar um receber feedback de 
      Se precisar, reabra como uma nova tarefa.`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🧾 Tarefa concluída. Se precisar, reabra como uma nova tarefa.` } },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔁 Reabrir" },
              action_id: TASK_REOPEN_ACTION_ID,
              value: taskId,
            },
          ],
        },
      ],
    });
  }
}
