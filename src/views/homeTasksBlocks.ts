import type { AnyBlock } from "@slack/web-api";
export type Urgency = "light" | "asap" | "turbo";
export const TASK_TOGGLE_ACTION_ID = "task_toggle_done" as const;

// ✅ aceita string (o que vem do Prisma) e normaliza
export type HomeTaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string | null; // slack id de quem delegou
  term?: Date | string | null;
  urgency: Urgency | string;  // ✅ mudou aqui
};

function normalizeUrgency(u: unknown): Urgency {
  if (u === "light" || u === "asap" || u === "turbo") return u;
  return "light"; // fallback seguro
}

function urgencyEmoji(u: unknown) {
  const x = normalizeUrgency(u);
  if (x === "light") return "🟢";
  if (x === "asap") return "🟡";
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
      accessory: {
        type: "checkboxes",
        action_id: TASK_TOGGLE_ACTION_ID,
        options: [
          {
            text: { type: "mrkdwn", text: "Concluir" },
            value: t.id, // <-- aqui vai o id da task
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

export type HomeTasksData = {
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];
};

export function homeTasksBlocks(args: HomeTasksData): AnyBlock[] {
  return [
    { type: "header", text: { type: "plain_text", text: "📌 Suas tarefas (você é responsável)" } },

    ...renderGroup("Hoje", args.tasksToday),
    { type: "divider" },

    ...renderGroup("Amanhã", args.tasksTomorrow),
    { type: "divider" },

    ...renderGroup("Futuras", args.tasksFuture),
  ];
}
