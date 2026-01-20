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

// action_id do checkbox (tem que bater com o interactive.ts)
export const TASK_SELECT_ACTION_ID = "task_select" as const;

// action_id do botão concluir
export const TASKS_CONCLUDE_SELECTED_ACTION_ID = "tasks_conclude_selected" as const;

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

function renderTaskItem(t: HomeTaskItem): AnyBlock[] {
  const blocks: AnyBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: taskTitleLine(t) },

      // ✅ checkbox ao lado esquerdo (accessory)
      // Observação: Slack exige "text" em options.
      // Pra ficar “sem texto”, usamos um ponto invisível/leve.
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [
          {
            text: { type: "plain_text", text: " " }, // fica visualmente “vazio”
            value: t.id,
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

export function homeTasksBlocks(args: {
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];
}): AnyBlock[] {
  return [
    { type: "header", text: { type: "plain_text", text: "📌 Suas tarefas (você é responsável)" } },

    ...renderGroup("Hoje", args.tasksToday),
    { type: "divider" },

    ...renderGroup("Amanhã", args.tasksTomorrow),
    { type: "divider" },

    ...renderGroup("Futuras", args.tasksFuture),
    { type: "divider" },

    // ✅ Botão de ação (age sobre as selecionadas)
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          action_id: TASKS_CONCLUDE_SELECTED_ACTION_ID,
          text: { type: "plain_text", text: "✅ Concluir selecionadas" },
          value: "conclude_selected",
        },
      ],
    },
  ];
}
