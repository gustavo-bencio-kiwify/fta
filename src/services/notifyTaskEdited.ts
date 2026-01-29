// src/services/notifyTaskEdited.ts
import type { WebClient } from "@slack/web-api";

type NotifyTaskEditedArgs = {
  slack: WebClient;

  taskTitle: string;

  editedBy: string; // slack id de quem editou (delegador)
  responsible: string; // slack id do responsável
  carbonCopies: string[]; // slack ids

  notifyResponsible?: boolean; // default true
};

function mention(userId: string) {
  return `<@${userId}>`;
}

function uniq(arr: string[]) {
  return Array.from(new Set((arr ?? []).filter(Boolean)));
}

async function openDmChannel(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel (DM)");
  return channelId;
}

async function dm(slack: WebClient, userId: string, text: string) {
  const channel = await openDmChannel(slack, userId);
  await slack.chat.postMessage({ channel, text });
}

export async function notifyTaskEdited(args: NotifyTaskEditedArgs) {
  const {
    slack,
    taskTitle,
    editedBy,
    responsible,
    carbonCopies,
    notifyResponsible = true,
  } = args;

  const ccUnique = uniq(carbonCopies)
    .filter((id) => id !== editedBy) // não notifica o editor como cc
    .filter(Boolean);

  // 1) mensagem para quem editou — somente na DM do bot
  const ccMentions = ccUnique.length ? ccUnique.map(mention).join(", ") : "sem cópias";
  const editedByText =
    `✏️ Você editou a tarefa *${taskTitle}*.` +
    ` O responsável ${mention(responsible)} já foi notificado` +
    ` e suas cópias ${ccMentions}.`;

  await dm(slack, editedBy, editedByText);

  // 2) responsável recebe DM do bot
  if (notifyResponsible && responsible && responsible !== editedBy) {
    const responsibleText = `✏️ Tarefa *${taskTitle}* editada por ${mention(editedBy)}.`;
    await dm(slack, responsible, responsibleText);
  }

  // 3) cópias recebem DM do bot
  await Promise.allSettled(
    ccUnique
      .filter((cc) => cc !== responsible) // evita duplicar se alguém está como resp+cc
      .map(async (cc) => {
        const ccText = `✏️ Tarefa *${taskTitle}* editada por ${mention(editedBy)}.`;
        await dm(slack, cc, ccText);
      })
  );
}
