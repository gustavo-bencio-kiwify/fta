import type { WebClient } from "@slack/web-api";

type NotifyTaskCreatedArgs = {
  slack: WebClient;
  createdBy: string;          // delegation / payload.user.id
  taskTitle: string;
  responsible: string;
  carbonCopies: string[];     // slack ids
};

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error(`Could not open DM for user ${userId}`);
  return channelId;
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, createdBy, taskTitle, responsible, carbonCopies } = args;

  // Remove duplicados + remove responsible da lista de CC (pra não receber msg de CC)
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // 1) Mensagem pro responsável
  const responsibleText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para você`;
  try {
    const channelId = await openDm(slack, responsible);
    await slack.chat.postMessage({ channel: channelId, text: responsibleText });
  } catch (e) {
    // não derruba a criação da task se notificação falhar
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // 2) Mensagem pros CCs
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
