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
  const conv = await slack.conversations.open({ users: userId, return_im: true });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error(`Could not open DM channel for userId=${userId}`);
  return channelId;
}

function slackErrDetails(e: any) {
  return { message: e?.message, code: e?.code, data: e?.data };
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, taskId, createdBy, taskTitle, responsible, carbonCopies } = args;

  // remove duplicados + remove responsible da lista de CC
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // 1) Mensagem pro responsável (AGORA: notifica mesmo se for você)
  try {
    const channelId = await openDm(slack, responsible);

    await slack.chat.postMessage({
      channel: channelId,
      text: `<@${createdBy}> atribuiu a atividade "${taskTitle}" para você`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*<@${createdBy}> atribuiu uma atividade para você*` },
        },
        { type: "section", text: { type: "mrkdwn", text: `*${taskTitle}*` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },
      ],
    });

    console.log("[notifyTaskCreated] notified responsible", { taskId, responsible });
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible", {
      taskId,
      responsible,
      ...slackErrDetails(e),
    });
  }

  // 2) Mensagem pros CCs (mantém como você queria)
  const ccText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
        const channelId = await openDm(slack, ccId);
        await slack.chat.postMessage({ channel: channelId, text: ccText });
        console.log("[notifyTaskCreated] notified CC", { taskId, ccId });
      } catch (e) {
        console.error("[notifyTaskCreated] failed to notify CC", {
          taskId,
          ccId,
          ...slackErrDetails(e),
        });
      }
    })
  );
}
