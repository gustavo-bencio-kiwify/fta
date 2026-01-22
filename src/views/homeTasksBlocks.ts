// src/slack/views/homeTasksBlocks.ts
import type { AnyBlock } from "@slack/web-api";

export type Urgency = "light" | "asap" | "turbo";

export type HomeTaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string | null;
  term?: Date | string | null;
  urgency: Urgency;
};

export const TASK_SELECT_ACTION_ID = "task_select" as const;

export const TASKS_CONCLUDE_SELECTED_ACTION_ID = "tasks_conclude_selected" as const;
export const TASKS_SEND_QUESTION_ACTION_ID = "tasks_send_question" as const;
export const TASKS_RESCHEDULE_ACTION_ID = "tasks_reschedule" as const;
export const TASKS_VIEW_DETAILS_ACTION_ID = "tasks_view_details" as const;
export const TASKS_REFRESH_ACTION_ID = "tasks_refresh" as const;

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

function taskMainLine(t: HomeTaskItem) {
  // ✅ mantém o “visual” do título (emoji + bold)
  return `${urgencyEmoji(t.urgency)} *${t.title}*`;
}

function taskMetaLine(t: HomeTaskItem) {
  // ✅ mantém os caracteres “(vence xx) — delegado por @...”
  const due = formatDateBR(t.term);
  const dueText = due ? `(vence ${due})` : null;
  const delegatedText = t.delegation ? `— delegado por <@${t.delegation}>` : null;

  const parts = [dueText, delegatedText].filter(Boolean);
  if (!parts.length) return null;

  // deixa levemente “comentário” como no seu print anterior
  return `_${parts.join(" ")}_`;
}

function renderTaskItem(t: HomeTaskItem): AnyBlock[] {
  const meta = taskMetaLine(t);

  const blocks: AnyBlock[] = [
    {
      type: "section",
      block_id: `task_${t.id}`,
      text: { type: "mrkdwn", text: taskMainLine(t) },
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [
          { text: { type: "plain_text", text: " " }, value: t.id },
        ],
      },
    },
  ];

  // ✅ Prazo/delegado embaixo, mas agora como SECTION (fica grande)
  if (meta) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: meta },
    });
  }

  // ✅ Descrição continua como context (pequena)
  if (t.description?.trim()) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: t.description.trim() }],
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

export function homeTasksBlocks(args: {
  tasksOverdue: HomeTaskItem[];
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];
}): AnyBlock[] {
  return [
    { type: "header", text: { type: "plain_text", text: "📌 Suas tarefas (você é responsável)" } },

    ...renderGroup("Atrasadas", args.tasksOverdue),
    { type: "divider" },

    ...renderGroup("Hoje", args.tasksToday),
    { type: "divider" },

    ...renderGroup("Amanhã", args.tasksTomorrow),
    { type: "divider" },

    ...renderGroup("Futuras", args.tasksFuture),
    { type: "divider" },

    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Concluir selecionadas" },
          action_id: TASKS_CONCLUDE_SELECTED_ACTION_ID,
          value: "conclude_selected",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❓ Enviar dúvida" },
          action_id: TASKS_SEND_QUESTION_ACTION_ID,
          value: "send_question",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📅 Reprogramar Prazo" },
          action_id: TASKS_RESCHEDULE_ACTION_ID,
          value: "reschedule",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔎 Ver detalhes" },
          action_id: TASKS_VIEW_DETAILS_ACTION_ID,
          value: "view_details",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Atualizar" },
          action_id: TASKS_REFRESH_ACTION_ID,
          value: "refresh",
        },
      ],
    },
  ];
}
