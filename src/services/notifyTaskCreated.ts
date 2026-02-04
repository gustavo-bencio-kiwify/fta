// src/services/notifyTaskCreated.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { TASKS_SEND_QUESTION_ACTION_ID } from "../views/homeTasksBlocks";

// action_id do botão "Concluir"
export const TASK_DETAILS_CONCLUDE_ACTION_ID = "task_details_conclude" as const;

export type NotifyTaskCreatedArgs = {
  slack: WebClient;
  taskId: string;
  createdBy: string;
  taskTitle: string;
  responsible: string;
  carbonCopies: string[];

  term?: Date | null;
  deadlineTime?: string | null;
};

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

function formatMentions(ids: string[]) {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (!unique.length) return "—";
  return unique.map((id) => `<@${id}>`).join(", ");
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, taskId, createdBy, responsible, carbonCopies } = args;
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter(Boolean);

  // busca a task pra garantir dados atuais
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      description: true,
      term: true,
      deadlineTime: true,
      urgency: true,
      delegation: true,
    },
  });

  const title = task?.title ?? args.taskTitle;
  const desc = safeDesc(task?.description ?? null);
  const prazo = formatPrazoBR(task?.term ?? null, (task as any)?.deadlineTime ?? null);
  const urg = urgencyLabel((task as any)?.urgency ?? null);

  // =======================================
  // 0) Mensagem pro criador (delegador)
  // =======================================
  if (createdBy && createdBy !== responsible) {
    try {
      const ccForCreator = ccUnique.filter((id) => id !== responsible && id !== createdBy);
      const ccText = formatMentions(ccForCreator);

      const creatorText =
        `✅ *Tarefa criada:* ${title}` +
        ` • *Resp:* <@${responsible}>` +
        ` • *Prazo:* ${prazo}` +
        ` • *Cópia:* ${ccText}`;

      const channelId = await openDm(slack, createdBy);
      await slack.chat.postMessage({
        channel: channelId,
        text: creatorText,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: creatorText } }],
      });
    } catch (e) {
      console.error("[notifyTaskCreated] failed to notify creator:", e);
    }
  }

  // =======================================
  // 1) Mensagem de abertura pro responsável
  // ✅ SALVA slackOpenChannelId + slackOpenMessageTs
  // =======================================
  try {
    const channelId = await openDm(slack, responsible);

    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `📌 *Delegado por:* <@${createdBy}>` },
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
            text: { type: "plain_text", text: "❓ Enviar dúvida" },
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

    // ✅ IMPORTANTÍSSIMO: guardar retorno
    const msg = await slack.chat.postMessage({
      channel: channelId,
      text: `<@${createdBy}> atribuiu a atividade "${title}" para você`,
      blocks,
    });

    // ✅ salva a thread da abertura (pra reminders irem pra lá)
    if (msg.ts) {
      await prisma.task.update({
        where: { id: taskId },
        data: { slackOpenChannelId: channelId, slackOpenMessageTs: msg.ts },
      });
    }
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // =======================================
  // 2) Mensagem pros CCs
  // =======================================
  const ccText = `👀 <@${createdBy}> atribuiu a atividade *${title}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
        if (!ccId) return;
        if (ccId === responsible) return;

        const channelId = await openDm(slack, ccId);

        await slack.chat.postMessage({
          channel: channelId,
          text: ccText,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: ccText } },
            { type: "section", text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` } },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "❓ Enviar dúvida" },
                  action_id: TASKS_SEND_QUESTION_ACTION_ID,
                  value: taskId,
                },
              ],
            },
          ],
        });
      } catch (e) {
        console.error(`[notifyTaskCreated] failed to notify CC ${ccId}:`, e);
      }
    })
  );
}
