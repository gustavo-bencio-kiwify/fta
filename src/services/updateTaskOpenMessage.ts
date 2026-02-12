// src/services/updateTaskOpenMessage.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { TASKS_SEND_QUESTION_ACTION_ID } from "../views/homeTasksBlocks";
import { TASK_DETAILS_CONCLUDE_ACTION_ID } from "./notifyTaskCreated";

const SAO_PAULO_TZ = "America/Sao_Paulo";

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

function urgencyLabel(u?: string | null) {
  if (u === "turbo") return "🔴 Turbo";
  if (u === "asap") return "🟡 ASAP";
  return "🟢 Light";
}

function formatPrazoBR(term?: Date | null, deadlineTime?: string | null) {
  if (!term || Number.isNaN(term.getTime())) return "—";
  const dateStr = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO_TZ }).format(term);
  const time = deadlineTime?.trim();
  return time ? `${dateStr} às ${time}` : dateStr;
}

function safeDesc(desc?: string | null) {
  const d = desc?.trim();
  return d ? d : "—";
}

/**
 * Atualiza a mensagem de abertura (DM) da task para refletir título/prazo/descrição/urgência atuais.
 * - usa slackOpenChannelId + slackOpenMessageTs se existirem
 * - se a task estiver done, NÃO atualiza (pra não desfazer o "✅ Concluída")
 */
export async function updateTaskOpenMessage(slack: WebClient, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      deadlineTime: true,
      urgency: true,
      status: true,
      responsible: true,
      delegation: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  if (!task) return { updated: false as const, reason: "not_found" as const };
  if (task.status === "done") return { updated: false as const, reason: "done" as const };

  // precisa ter mensagem “principal” salva
  if (!task.slackOpenMessageTs) return { updated: false as const, reason: "no_ts" as const };

  const createdBy = task.delegation ?? task.responsible;
  const title = task.title;
  const desc = safeDesc(task.description ?? null);
  const prazo = formatPrazoBR(task.term ?? null, task.deadlineTime ?? null);
  const urg = urgencyLabel(task.urgency ?? null);

  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `📌 *Delegado por:* <@${createdBy}>` } },
    { type: "section", text: { type: "mrkdwn", text: `🚨 *Urgência:* ${urg}` } },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Título:* ${title}` },
        { type: "mrkdwn", text: `*Descrição:* ${desc}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅ Concluir" },
          action_id: TASK_DETAILS_CONCLUDE_ACTION_ID,
          value: taskId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":thread: Abrir thread" },
          action_id: TASKS_SEND_QUESTION_ACTION_ID,
          value: taskId,
        },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },
  ];

  // garante que o channel é o DM do responsável atual (se mudou responsável, o DM muda)
  const responsibleDmChannel = await openDm(slack, task.responsible);

  // se o channel salvo está diferente do DM atual, atualiza o registro pra ficar consistente
  const channelToUpdate = task.slackOpenChannelId ?? responsibleDmChannel;

  await slack.chat.update({
    channel: channelToUpdate,
    ts: task.slackOpenMessageTs,
    text: `<@${createdBy}> atribuiu a atividade "${title}" para você`,
    blocks,
  });

  // normaliza no banco
  if (task.slackOpenChannelId !== channelToUpdate) {
    await prisma.task.update({
      where: { id: taskId },
      data: { slackOpenChannelId: channelToUpdate },
    });
  }

  return { updated: true as const };
}
