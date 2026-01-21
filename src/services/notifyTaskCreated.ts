// src/services/notifyTaskCreated.ts
import type { WebClient } from "@slack/web-api";

export type Urgency = "light" | "asap" | "turbo";

export type NotifyTaskCreatedArgs = {
  slack: WebClient;
  taskId: string;
  createdBy: string;
  taskTitle: string;

  responsible: string;
  carbonCopies: string[];

  // para ficar igual ao print:
  description?: string | null;
  term?: Date | string | null; // prazo
  urgency?: Urgency;
};

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId, return_im: true });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error(`Could not open DM channel for userId=${userId}`);
  return channelId;
}

function urgencyLabel(u: Urgency) {
  if (u === "light") return "🟢 Light";
  if (u === "asap") return "🟡 ASAP";
  return "🔴 Turbo";
}

function formatDateBR(d?: Date | string | null) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
}

function slackErrDetails(e: any) {
  return { message: e?.message, code: e?.code, data: e?.data };
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
    urgency = "light",
  } = args;

  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // =========
  // 1) DM pro responsável (igual ao print)
  // =========
  try {
    const channelId = await openDm(slack, responsible);

    const prazo = formatDateBR(term);
    const desc = description?.trim() ? description.trim() : "—";

    await slack.chat.postMessage({
      channel: channelId,

      // fallback
      text: `📌 Delegado por <@${createdBy}> • Urgência: ${urgencyLabel(urgency)} • ${taskTitle} (Prazo: ${prazo})`,

      blocks: [
        // "Finance Tasks" (no Slack aparece como header grande)
        { type: "header", text: { type: "plain_text", text: "Finance Tasks" } },

        // Delegado por
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `📌 *Delegado por:* <@${createdBy}>` }],
        },

        // Urgência
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `🚨 *Urgência:* ${urgencyLabel(urgency)}` }],
        },

        { type: "divider" },

        // 2 colunas: Nome da tarefa | Descrição
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Nome da tarefa:* ${taskTitle}` },
            { type: "mrkdwn", text: `*Descrição:* ${desc}` },
          ],
        },

        // Prazo
        { type: "section", text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` } },

        // Botões (mesma ideia do print)
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "✅ Concluir" },
              action_id: "task_details_conclude",
              value: taskId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❓ Enviar dúvida" },
              action_id: "task_details_question",
              value: taskId,
            },
          ],
        },

        // UID embaixo
        { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${taskId}\`` }] },

        { type: "divider" },
      ],
    });

    console.log("[notifyTaskCreated] notified responsible", { taskId, responsible });
  } catch (e) {
    console.error("[notifyTaskCreated] failed to notify responsible", {
      taskId,
      responsible,
      ...slackErrDetails(e),
    });
  }

  // =========
  // 2) DM pros CCs (mantém simples como você pediu)
  // =========
  const ccText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para <@${responsible}> (você está em cópia)`;

  await Promise.all(
    ccUnique.map(async (ccId) => {
      try {
        const channelId = await openDm(slack, ccId);
        await slack.chat.postMessage({ channel: channelId, text: ccText });
        console.log("[notifyTaskCreated] notified CC", { taskId, ccId });
      } catch (e) {
        console.error("[notifyTaskCreated] failed to notify CC", {
          taskId,
          ccId,
          ...slackErrDetails(e),
        });
      }
    })
  );
}
