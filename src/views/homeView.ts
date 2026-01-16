import type { HomeView, AnyBlock } from "@slack/web-api";

export const HOME_CREATE_TASK_ACTION_ID = "home_create_task" as const;
export const HOME_SEND_BATCH_ACTION_ID = "home_send_batch" as const;
export const HOME_NEW_PROJECT_ACTION_ID = "home_new_project" as const;

export type Urgency = "light" | "asap" | "turbo";

export type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string; // slack id de quem delegou
  term?: Date | string | null;
  urgency: Urgency;
};

function urgencyEmoji(u: Urgency) {
  if (u === "light") return "🟢";
  if (u === "asap") return "🟡";
  return "🔴";
}

function formatDateBR(d?: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  // dd/MM/yyyy
  return dt.toLocaleDateString("pt-BR");
}

function taskLine(t: TaskItem) {
  const due = formatDateBR(t.term);
  const dueText = due ? ` (vence ${due})` : "";
  const delegatedText = t.delegation ? ` — delegado por <@${t.delegation}>` : "";

  return `${urgencyEmoji(t.urgency)} *${t.title}*${dueText}${delegatedText}`;
}

function renderTaskList(tasks: TaskItem[]): AnyBlock[] {
  // “home” não suporta checklist real interativa sem mais wiring,
  // então aqui é visual (igual seu print).
  return tasks.flatMap((t) => {
    const blocks: AnyBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `☐ ${taskLine(t)}` },
      },
    ];

    if (t.description) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: t.description }],
      });
    }

    return blocks;
  });
}

function renderGroup(title: string, tasks: TaskItem[]): AnyBlock[] {
  const blocks: AnyBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${title}:*` } },
  ];

  if (!tasks.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Nenhuma_" },
    });
    return blocks;
  }

  return blocks.concat(renderTaskList(tasks));
}

export function homeView(args?: {
  tasksToday?: TaskItem[];
  tasksTomorrow?: TaskItem[];
  tasksFuture?: TaskItem[];
}): HomeView {
  const tasksToday = args?.tasksToday ?? [];
  const tasksTomorrow = args?.tasksTomorrow ?? [];
  const tasksFuture = args?.tasksFuture ?? [];

  const blocks: AnyBlock[] = [
    // ===== HEADER =====
    { type: "header", text: { type: "plain_text", text: "📌 Suas tarefas (você é responsável)" } },

    // ===== BOTÕES NO TOPO =====
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "➕ Criar Tarefa" },
          style: "primary",
          action_id: HOME_CREATE_TASK_ACTION_ID,
          value: "create_task",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📤 Enviar lote" },
          action_id: HOME_SEND_BATCH_ACTION_ID,
          value: "send_batch",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📂 Criar Projeto" },
          action_id: HOME_NEW_PROJECT_ACTION_ID,
          value: "new_project",
        },
      ],
    },

    { type: "divider" },

    // ===== LISTAS =====
    ...renderGroup("Hoje", tasksToday),
    { type: "divider" },
    ...renderGroup("Amanhã", tasksTomorrow),
    { type: "divider" },
    ...renderGroup("Futuras", tasksFuture),
  ];

  return { type: "home", blocks };
}
