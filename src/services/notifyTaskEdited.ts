// src/services/notifyTaskEdited.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

type NotifyTaskEditedArgs = {
  slack: WebClient;

  taskId: string;
  taskTitle?: string; // opcional (fallback)

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
  const { slack, taskId, editedBy, responsible, carbonCopies, notifyResponsible = true } = args;

  const ccUnique = uniq(carbonCopies)
    .filter((id) => id !== editedBy) // não notifica o editor como cc
    .filter(Boolean);

  // pega a thread “principal” (mensagem de criação) salva na Task
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  const title = task?.title ?? args.taskTitle ?? "tarefa";
  const channelId = task?.slackOpenChannelId ?? null;
  const threadTs = task?.slackOpenMessageTs ?? null;

  // monta texto do update dentro da thread principal
  const ccMentions = ccUnique.filter((cc) => cc !== responsible).map(mention);
  const ccText = ccMentions.length ? ` • *Cópia:* ${ccMentions.join(", ")}` : "";

  const threadText = `✏️ Tarefa *${title}* editada por ${mention(editedBy)}.${ccText}`;

  // ✅ 1) PRIORIDADE: postar na thread da mensagem de criação (igual FUPs)
  if (channelId && threadTs) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: threadText,
    });
  } else {
    // fallback (se não tiver thread salva por algum motivo):
    // 2) responsável recebe DM do bot
    if (notifyResponsible && responsible && responsible !== editedBy) {
      const responsibleText = `✏️ Tarefa *${title}* editada por ${mention(editedBy)}.`;
      await dm(slack, responsible, responsibleText);
    }

    // 3) cópias recebem DM do bot
    await Promise.allSettled(
      ccUnique
        .filter((cc) => cc !== responsible)
        .map(async (cc) => {
          const ccTextFallback = `✏️ Tarefa *${title}* editada por ${mention(editedBy)}.`;
          await dm(slack, cc, ccTextFallback);
        })
    );
  }

  // ✅ opcional: confirmação pra quem editou (mantive, mas bem enxuto)
  // se você quiser 100% “sem DM”, pode remover esse bloco.
  try {
    const editedByText = channelId && threadTs
      ? `✏️ Atualização registrada na thread da tarefa *${title}*.`
      : `✏️ Você editou a tarefa *${title}*.`;
    await dm(slack, editedBy, editedByText);
  } catch {
    // ignora
  }
}
