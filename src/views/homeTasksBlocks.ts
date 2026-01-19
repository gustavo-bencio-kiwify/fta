// src/slack/views/homeTasksBlocks.ts
import type { AnyBlock } from "@slack/web-api";

/**
 * Ações / IDs (usadas no interactive.ts)
 */
export const TASK_SELECT_ACTION_ID = "task_select" as const;

export const HOME_BULK_COMPLETE = "home_bulk_complete" as const;
export const HOME_BULK_HELP = "home_bulk_help" as const;
export const HOME_BULK_RESCHEDULE = "home_bulk_reschedule" as const;
export const HOME_BULK_DETAILS = "home_bulk_details" as const;
export const HOME_REFRESH = "home_refresh" as const;

/**
 * Tipos do "front"
 */
export type Urgency = "light" | "asap" | "turbo";

export type HomeTaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string | null; // Slack ID de quem delegou
  term?: Date | string | null; // prazo
  urgency: Urgency;
};

const ZERO_WIDTH = "\u200B"; // Slack exige text em checkbox; isso deixa “sem label” na UI

function urgencyEmoji(u: Urgency) {
  if (u === "light") return "🟢";
  if (u === "asap") return "🟡";
  return "🔴";
}

function formatDateBR(d?: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("pt-BR");
}

function taskTitleLine(t: HomeTaskItem) {
  const due = formatDateBR(t.term);
  const dueText = due ? ` (vence ${due})` : "";
  const delegatedText = t.delegation ? ` — delegado por <@${t.delegation}>` : "";
  return `${urgencyEmoji(t.urgency)} *${t.title}*${dueText}${delegatedText}`;
}

/**
 * Cada task: título + checkbox (só seleção, sem texto)
 */
function renderTaskItem(t: HomeTaskItem): AnyBlock[] {
  const blocks: AnyBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: taskTitleLine(t) },
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [
          {
            text: { type: "mrkdwn", text: ZERO_WIDTH },
            value: t.id, // <-- aqui vai o ID da task selecionada
          },
        ],
      },
    },
  ];

  if (t.description) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: t.description }],
    });
  }

  return blocks;
}

function renderGroup(title: string, tasks: HomeTaskItem[]): AnyBlock[] {
  const blocks: AnyBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${title}:*` } },
  ];

  if (!tasks.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhuma_" } });
    return blocks;
  }

  return blocks.concat(tasks.flatMap(renderTaskItem));
}

/**
 * Bloco de botões que atuam nas SELECIONADAS
 */
function bulkActionsBlocks(): AnyBlock[] {
  return [
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Concluir selecionadas" },
          style: "primary",
          action_id: HOME_BULK_COMPLETE,
          value: "complete",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❓ Enviar dúvida" },
          action_id: HOME_BULK_HELP,
          value: "help",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📅 Reprogramar Prazo" },
          action_id: HOME_BULK_RESCHEDULE,
          value: "reschedule",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔎 Ver detalhes" },
          action_id: HOME_BULK_DETAILS,
          value: "details",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Atualizar" },
          action_id: HOME_REFRESH,
          value: "refresh",
        },
      ],
    },
  ];
}

/**
 * Export principal: somente a parte “lista de tasks” (com ações em lote no final).
 * (A parte dos botões do topo fica no homeHeaderActionsBlocks.ts)
 */
export function homeTasksBlocks(args: {
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];
}): AnyBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "📌 Suas tarefas (você é responsável)" },
    },

    ...renderGroup("Hoje", args.tasksToday),
    { type: "divider" },

    ...renderGroup("Amanhã", args.tasksTomorrow),
    { type: "divider" },

    ...renderGroup("Futuras", args.tasksFuture),

    ...bulkActionsBlocks(),
  ];
}
