// src/services/notifyTaskCreated.ts
import type { WebClient } from "@slack/web-api";

export type NotifyTaskCreatedArgs = {
  slack: WebClient;
  taskId: string;
  createdBy: string;
  taskTitle: string;
  responsible: string;
  carbonCopies: string[];
};

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, taskId, createdBy, taskTitle, responsible, carbonCopies } = args;

  // remove duplicados + remove responsible da lista de CC
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // ✅ Se criou pra si mesmo, evita spam (você pode mudar essa regra)
  const notifySelf = createdBy === responsible;

  // 1) Mensagem pro responsável (estilo do seu print: blocos)
  if (!notifySelf) {
    try {
      const channelId = await openDm(slack, responsible);

      await slack.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*<@${createdBy}> atribuiu uma atividade para você*`,
            },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${taskTitle}*` },
          },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `ID: \`${taskId}\`` }],
          },
        ],
        text: `<@${createdBy}> atribuiu a atividade "${taskTitle}" para você`,
      });
    } catch (e) {
      console.error("[notifyTaskCreated] failed to notify responsible:", e);
    }
  }

  // 2) Mensagem pros CCs (mantém como você queria)
  const ccText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
        const channelId = await openDm(slack, ccId);
        await slack.chat.postMessage({ channel: channelId, text: ccText });
      } catch (e) {
        console.error(`[notifyTaskCreated] failed to notify CC ${ccId}:`, e);
      }
    })
  );
}
