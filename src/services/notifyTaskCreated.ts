// src/services/notifyTaskCreated.ts
import type { WebClient, KnownBlock } from "@slack/web-api";

export type NotifyTaskCreatedArgs = {
  slack: WebClient;
  taskId: string;
  createdBy: string;
  taskTitle: string;
  responsible: string;
  carbonCopies: string[];
  description?: string | null;
  term?: Date | string | null;
  urgency?: "light" | "asap" | "turbo";
};

// action_ids dos botões do DM (TEM que bater com o interactive.ts)
const TASK_DETAILS_CONCLUDE_ACTION_ID = "task_details_conclude" as const;
const TASK_DETAILS_QUESTION_ACTION_ID = "task_details_question" as const;

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

function urgencyLabel(u?: "light" | "asap" | "turbo") {
  if (u === "asap") return "🟡 ASAP";
  if (u === "turbo") return "🔴 Turbo";
  return "🟢 Light";
}

function formatPrazoBR(term?: Date | string | null) {
  if (!term) return "—";
  const dt = typeof term === "string" ? new Date(term) : term;
  if (Number.isNaN(dt.getTime())) return "—";
  // você pode trocar por dd/MM se preferir
  return dt.toLocaleDateString("pt-BR");
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const {
    slack,
    taskId,
    createdBy,
    taskTitle,
    responsible,
    carbonCopies,
    description,
    term,
    urgency,
  } = args;

  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // ✅ você pediu para notificar você mesmo também → não bloqueia mais
  // (ou seja, sempre notifica o responsável, mesmo se createdBy === responsible)

  // ===== 1) Mensagem pro responsável (layout grande) =====
  try {
    const channelId = await openDm(slack, responsible);

    const blocks: KnownBlock[] = [
      // Linha "Delegado por"
      {
        type: "section",
        text: { type: "mrkdwn", 
          text: 
          `📌 *Delegado por:* <@${createdBy}>\n`+
          `🚨 *Urgência:* ${urgencyLabel(urgency)}`
         },
      },
      { type: "divider" },

      // Corpo (grande)
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Nome da tarefa:* ${taskTitle}\n` +
            `*Descrição:* ${description?.trim() ? description.trim() : "—"}\n` +
            `*Prazo:* ${formatPrazoBR(term)}`,
        },
      },

      // Botões
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: TASK_DETAILS_CONCLUDE_ACTION_ID,
            text: { type: "plain_text", text: "✅ Concluir" },
            value: taskId, // <- usado pelo interactive pra deletar
          },
          {
            type: "button",
            action_id: TASK_DETAILS_QUESTION_ACTION_ID,
            text: { type: "plain_text", text: "❓ Enviar dúvida" },
            value: taskId,
          },
        ],
      },

      // UID (grande). Se quiser pequeno, troque por context.
      {
        type: "section",
        text: { type: "mrkdwn", text: `UID: \`${taskId}\`` },
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

  // ===== 2) Mensagem pros CCs (mantém simples, como você pediu) =====
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
