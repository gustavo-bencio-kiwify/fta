import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { TASKS_RESCHEDULE_ACTION_ID, TASKS_SEND_QUESTION_ACTION_ID } from "../views/homeTasksBlocks";
import { TASK_DETAILS_CONCLUDE_ACTION_ID } from "./notifyTaskCreated";

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
  const dateStr = term.toLocaleDateString("pt-BR");
  const time = deadlineTime?.trim();
  return time ? `${dateStr} às ${time}` : dateStr;
}

function safeDesc(desc?: string | null) {
  const d = desc?.trim();
  return d ? d : "—";
}

/**
 * ✅ Quando muda responsável no EDIT:
 * - Atualiza a mensagem antiga (DM do responsável antigo): "você não é mais o responsável"
 * - Envia nova mensagem "de criação" pro novo responsável
 * - Move slackOpenChannelId/slackOpenMessageTs pra nova mensagem
 */
export async function handleTaskResponsibleReassign(args: {
  slack: WebClient;
  taskId: string;
  editedBySlackId: string; // quem fez a edição (pra texto de contexto)
}) {
  const { slack, taskId, editedBySlackId } = args;

  // Pega dados atuais + ponteiro da mensagem "antiga"
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      deadlineTime: true,
      urgency: true,
      delegation: true,
      responsible: true,
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  if (!task) return;

  // 1) Atualiza a mensagem antiga (se existir)
  if (task.slackOpenChannelId && task.slackOpenMessageTs) {
    const text = `✏️ Tarefa editada por <@${editedBySlackId}>. Você não é mais o responsável.`;

    const blocks: KnownBlock[] = [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },
    ];

    try {
      await slack.chat.update({
        channel: task.slackOpenChannelId,
        ts: task.slackOpenMessageTs,
        text,
        blocks,
      });
    } catch {
      // se falhar, não trava a reatribuição
    }
  }

  // 2) Envia a "mensagem de criação" para o NOVO responsável
  const channelIdNew = await openDm(slack, task.responsible);

  const title = task.title ?? "tarefa";
  const desc = safeDesc(task.description ?? null);
  const prazo = formatPrazoBR(task.term ?? null, task.deadlineTime ?? null);
  const urg = urgencyLabel((task as any).urgency ?? null);

  const blocksNew: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `📌 *Delegado por:* <@${task.delegation ?? editedBySlackId}>` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `✏️ *Reatribuída por:* <@${editedBySlackId}>` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `🚨 *Urgência:* ${urg}` },
    },

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
          text: { type: "plain_text", text: "📅 Reprogramar Prazo" },
          action_id: TASKS_RESCHEDULE_ACTION_ID,
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

    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }],
    },
  ];

  const msg = await slack.chat.postMessage({
    channel: channelIdNew,
    text: `📌 Você agora é o responsável pela tarefa *${title}*`,
    blocks: blocksNew,
  });

  // 3) Move o ponteiro da mensagem principal pra nova DM/thread
  if (msg.ts) {
    await prisma.task.update({
      where: { id: taskId },
      data: { slackOpenChannelId: channelIdNew, slackOpenMessageTs: msg.ts },
    });
  }
}
