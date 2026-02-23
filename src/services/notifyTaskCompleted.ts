// src/services/notifyTaskCompleted.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";

export const TASK_REOPEN_ACTION_ID = "task_reopen" as const;

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function urgencyEmoji(u: string | null | undefined) {
  if (u === "asap") return "🟡";
  if (u === "turbo") return "🔴";
  return "🟢";
}

function urgencyLabel(u: string | null | undefined) {
  if (u === "asap") return "Asap";
  if (u === "turbo") return "Turbo";
  return "Light";
}

function formatDateBRFromDate(d: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
}

async function openConversationWithUsers(slack: WebClient, userIds: string[]) {
  const users = uniq(userIds).join(",");
  const conv = await slack.conversations.open({ users });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel id");
  return channelId;
}

async function postThreadMessageWithReopen(slack: WebClient, args: { channel: string; threadTs: string; taskId: string; text: string }) {
  const { channel, threadTs, taskId, text } = args;

  await slack.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
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
      description: true,
      term: true,
      urgency: true,
      responsible: true,
      delegation: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (!task) return;

  const responsibleId = task.responsible;
  const delegationId = task.delegation ?? task.responsible;
  const ccIds = uniq(task.carbonCopies.map((c) => c.slackUserId));
  const participants = uniq([responsibleId, delegationId, ...ccIds]);

  const isSelfOnly = participants.length === 1;

  const rootDmText = `✅ A tarefa *${task.title}* foi concluída.`;

  const ccMentions = ccIds.map((id) => `<@${id}>`).join(", ");
  const ccSuffix = ccIds.length ? `, com cópia para ${ccMentions}` : "";
  const feedbackText = `<@${responsibleId}>, aqui você pode dar ou receber feedback de <@${delegationId}>${ccSuffix}. Se precisar, reabra como uma nova tarefa.`;

  // =========================================================
  // (1) Atualiza a mensagem raiz (ABERTURA) removendo botões e colocando "✅ Concluída"
  // =========================================================
  if (task.slackOpenChannelId && task.slackOpenMessageTs) {
    const prazo = formatDateBRFromDate(task.term ?? null);
    const desc = (task.description ?? "").trim() || "—";
    const urgEmoji = urgencyEmoji(task.urgency as any);
    const urgLabel = urgencyLabel(task.urgency as any);

    // ✅ Recria os blocks da abertura SEM actions
    // e troca o lugar dos botões por "✅ Concluída ..."
    const updatedBlocks: KnownBlock[] = [
      { type: "section", text: { type: "mrkdwn", text: `📌 *Delegado por:* <@${delegationId}>` } },
      { type: "section", text: { type: "mrkdwn", text: `🚨 *Urgência:* ${urgEmoji} ${urgLabel}` } },

      { type: "divider" },

      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Título:* ${task.title}\n` +
            `*Descrição:* ${desc}\n\n` +
            `*Prazo:* ${prazo}`,
        },
      },

      // ✅ substitui os botões por texto
      { type: "section", text: { type: "mrkdwn", text: `✅ *Concluída* por <@${completedBySlackId}>` } },

      { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },
    ];

    await slack.chat.update({
      channel: task.slackOpenChannelId,
      ts: task.slackOpenMessageTs,
      text: `✅ Concluída`,
      blocks: updatedBlocks,
    });
  }

  // =========================================================
  // (2) Reabrir: SOMENTE em mensagem dentro da thread
  // - self-only: thread da mensagem principal
  // - >1 participante: abre MPIM, posta msg raiz e na thread posta feedback + botão Reabrir
  // =========================================================

  if (isSelfOnly) {
    if (task.slackOpenChannelId && task.slackOpenMessageTs) {
      // ✅ cria uma mensagem na thread (não na raiz) com botão Reabrir
      await postThreadMessageWithReopen(slack, {
        channel: task.slackOpenChannelId,
        threadTs: task.slackOpenMessageTs,
        taskId,
        text: `🧾 Tarefa concluída.`,
      });

      // ✅ e também coloca o feedback na thread (sem botão)
      await slack.chat.postMessage({
        channel: task.slackOpenChannelId,
        thread_ts: task.slackOpenMessageTs,
        text: rootDmText,
      });
      await slack.chat.postMessage({
        channel: task.slackOpenChannelId,
        thread_ts: task.slackOpenMessageTs,
        text: feedbackText,
      });
    }
    return;
  }

  // ✅ mais de um participante => UM MPIM com todos
  const mpimChannel = await openConversationWithUsers(slack, participants);

  // raiz do MPIM (sem botão)
  const root = await slack.chat.postMessage({ channel: mpimChannel, text: rootDmText });
  const rootTs = root.ts;
  if (!rootTs) return;

  // thread do MPIM: feedback + botão reabrir (somente aqui)
  await postThreadMessageWithReopen(slack, {
    channel: mpimChannel,
    threadTs: rootTs,
    taskId,
    text: feedbackText,
  });
}
