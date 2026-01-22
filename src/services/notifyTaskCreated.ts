// src/services/notifyTaskCreated.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { TASKS_SEND_QUESTION_ACTION_ID } from "../views/homeTasksBlocks";

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

/**
 * Formata prazo no padrão BR.
 * - Se tiver term: mostra dd/MM/yyyy
 * - Se tiver deadlineTime (seu novo campo), concatena "às HH:mm"
 * - Se não tiver: retorna null (e aí você decide se mostra "-" ou omite)
 */
function formatPrazoBR(term?: Date | null, deadlineTime?: string | null) {
  if (!term || Number.isNaN(term.getTime())) return null;

  const dateStr = term.toLocaleDateString("pt-BR");

  const time = deadlineTime?.trim();
  if (time) return `${dateStr} às ${time}`;

  return dateStr;
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const { slack, taskId, createdBy, taskTitle, responsible, carbonCopies } = args;

  // remove duplicados
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter(Boolean);

  // ✅ Busca a task no banco pra pegar o prazo real (term / deadlineTime)
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      term: true,
      // se você ainda NÃO tem deadlineTime no model, pode remover a linha abaixo
      deadlineTime: true,
    },
  });

  const prazo = formatPrazoBR(task?.term ?? null, (task as any)?.deadlineTime ?? null);

  // 1) Mensagem pro responsável (sempre notifica, inclusive pra si mesmo)
  try {
    const channelId = await openDm(slack, responsible);

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "📌 Nova tarefa atribuída" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Delegado por:* <@${createdBy}>` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${taskTitle}*` },
      },

      // ✅ Prazo (só mostra se existir)
      ...(prazo
        ? ([
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` },
            },
          ] as KnownBlock[])
        : ([] as KnownBlock[])),

      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }],
      },
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
    ];

    await slack.chat.postMessage({
      channel: channelId,
      text: `<@${createdBy}> atribuiu a atividade "${taskTitle}" para você`,
      blocks,
    });
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // 2) Mensagem pros CCs (mantém como você queria)
  const ccText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
        if (ccId === responsible) return;

        const channelId = await openDm(slack, ccId);

        const blocks: KnownBlock[] = [
          { type: "section", text: { type: "mrkdwn", text: ccText } },

          ...(prazo
            ? ([
                {
                  type: "section",
                  text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` },
                },
              ] as KnownBlock[])
            : ([] as KnownBlock[])),

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
        ];

        await slack.chat.postMessage({
          channel: channelId,
          text: ccText,
          blocks,
        });
      } catch (e) {
        console.error(`[notifyTaskCreated] failed to notify CC ${ccId}:`, e);
      }
    })
  );
}
