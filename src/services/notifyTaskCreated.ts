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

// Mensagem pro responsável 
  try {
    const channelId = await openDm(slack, responsible);

    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", 
          text: 
          `📌 *Delegado por:* <@${createdBy}>\n`+
          `🚨 *Urgência:* ${urgencyLabel(urgency)}`
         },
      },
      { type: "divider" },

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

      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: TASK_DETAILS_CONCLUDE_ACTION_ID,
            text: { type: "plain_text", text: "✅ Concluir" },
            value: taskId,
          },
          {
            type: "button",
            action_id: TASK_DETAILS_QUESTION_ACTION_ID,
            text: { type: "plain_text", text: "❓ Enviar dúvida" },
            value: taskId,
          },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `UID: \`${taskId}\`` },
      },
    ];

    //Popup Resp
    await slack.chat.postMessage({
      channel: channelId,
      text: `<@${createdBy}> atribuiu a atividade "${taskTitle}" para você`,
      blocks,
    });
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // Popup CC
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
