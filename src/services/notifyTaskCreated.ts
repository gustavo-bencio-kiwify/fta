// src/services/notifyTaskCreated.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { TASKS_SEND_QUESTION_ACTION_ID } from "../views/homeTasksBlocks";

// ✅ action_id do botão "Concluir" na mensagem (o interactive precisa tratar)
export const TASK_DETAILS_CONCLUDE_ACTION_ID = "task_details_conclude" as const;

export type NotifyTaskCreatedArgs = {
  slack: WebClient;
  taskId: string;
  createdBy: string;
  taskTitle: string;
  responsible: string;
  carbonCopies: string[];

  // ✅ opcionais (pra não quebrar o interactive quando você passar term)
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

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, taskId, createdBy, responsible, carbonCopies } = args;

  // remove duplicados
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter(Boolean);

  // ✅ Busca no banco: garante prazo/descrição/urgência corretos
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

  // ======================
  // 1) Mensagem pro responsável (sempre, inclusive self)
  // ======================
  try {
    const channelId = await openDm(slack, responsible);

    const blocks: KnownBlock[] = [
      // Linha 1 (grande)
      {
        type: "section",
        text: { type: "mrkdwn", text: `📌 *Delegado por:* <@${createdBy}>` },
      },
      // Linha 2 (grande)
      {
        type: "section",
        text: { type: "mrkdwn", text: `🚨 *Urgência:* ${urg}` },
      },

      { type: "divider" },

      // Nome + Descrição (maior, estilo do print)
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Nome da tarefa:* ${title}` },
          { type: "mrkdwn", text: `*Descrição:* ${desc}` },
        ],
      },

      // Prazo
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` },
      },

      // Botões
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
            action_id: TASKS_SEND_QUESTION_ACTION_ID, // pode reutilizar o mesmo handler
            value: taskId,
          },
        ],
      },

      // UID
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }],
      },
    ];

    await slack.chat.postMessage({
      channel: channelId,
      text: `<@${createdBy}> atribuiu a atividade "${title}" para você`,
      blocks,
    });
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // ======================
  // 2) Mensagem pros CCs (mantém simples)
  // ======================
  const ccText = `👀 <@${createdBy}> atribuiu a atividade *${title}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
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
