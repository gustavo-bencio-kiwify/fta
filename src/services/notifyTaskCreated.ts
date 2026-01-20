// src/services/notifyTaskCreated.ts
import type { WebClient, AnyBlock } from "@slack/web-api";

type Urgency = "light" | "asap" | "turbo";

export type NotifyTaskCreatedArgs = {
  slack: WebClient;

  // quem criou/delegou
  createdBy: string;

  // dados da task
  taskId: string;
  taskTitle: string;
  description?: string | null;
  responsible: string;
  urgency?: Urgency | string | null;
  term?: Date | string | null;

  // slack ids em cópia
  carbonCopies?: string[];
};

// action_id dos botões da notificação (se quiser tratar no /interactive depois)
export const TASK_DETAILS_CONCLUDE_ACTION_ID = "task_details_conclude" as const;
export const TASK_DETAILS_QUESTION_ACTION_ID = "task_details_question" as const;

async function openDm(slack: WebClient, userId: string): Promise<string> {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

function normalizeUrgency(u: unknown): Urgency {
  if (u === "light" || u === "asap" || u === "turbo") return u;
  return "light";
}

function urgencyLabel(u: Urgency) {
  if (u === "light") return "🟢 Light";
  if (u === "asap") return "🟡 ASAP";
  return "🔴 Turbo";
}

function formatShortDateBR(d?: Date | string | null): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  // dd/MM
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export async function notifyTaskCreated(args: NotifyTaskCreatedArgs) {
  const {
    slack,
    createdBy,
    taskId,
    taskTitle,
    description,
    responsible,
    carbonCopies,
    term,
    urgency,
  } = args;

  // Remove duplicados + remove responsible da lista de CC (pra não receber msg de CC)
  const ccUnique = Array.from(new Set(carbonCopies ?? [])).filter((id) => id !== responsible);

  // Texto fallback (quando Slack não renderiza blocks em alguns lugares)
  const responsibleText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para você`;
  const ccText = `<@${createdBy}> atribuiu a atividade *${taskTitle}* para <@${responsible}> (você está em cópia)`;

  const u = normalizeUrgency(urgency);
  const prazo = formatShortDateBR(term);

  // ====== BLOCO NO ESTILO DO PRINT (responsável) ======
  const blocks: AnyBlock[] = [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📌 *Delegado por:* <@${createdBy}>` }],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `🚨 *Urgência:* ${urgencyLabel(u)}` }],
    },
    { type: "divider" },

    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Nome da tarefa:* ${taskTitle}` },
        {
          type: "mrkdwn",
          text: `*Descrição:* ${description?.trim() ? description : "_Sem descrição_"}`,
        },
      ],
    },

    ...(prazo
      ? ([
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Prazo:* ${prazo}` },
          } as const,
        ] as AnyBlock[])
      : []),

    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Concluir" },
          style: "primary",
          action_id: TASK_DETAILS_CONCLUDE_ACTION_ID,
          value: taskId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❓ Enviar dúvida" },
          action_id: TASK_DETAILS_QUESTION_ACTION_ID,
          value: taskId,
        },
      ],
    },

    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `UID: ${taskId}` }],
    },
  ];

  // 1) Mensagem pro responsável (com blocks)
  try {
    const channelId = await openDm(slack, responsible);
    await slack.chat.postMessage({
      channel: channelId,
      text: responsibleText,
      blocks,
    });
  } catch (e) {
    // não derruba a criação da task se notificação falhar
    console.error("[notifyTaskCreated] failed to notify responsible:", e);
  }

  // 2) Mensagem pros CCs (mantém simples, como você pediu)
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
