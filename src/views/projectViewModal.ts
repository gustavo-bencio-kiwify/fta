// src/views/projectViewModal.ts
import type {
  KnownBlock,
  View,
  ActionsBlock,
  ActionsBlockElement,
  StaticSelect,
  Button,
  ContextBlock,
  MrkdwnElement,
} from "@slack/web-api";

export const PROJECT_VIEW_MODAL_CALLBACK_ID = "project_view_modal" as const;

export const PROJECT_MODAL_FILTER_BLOCK_ID = "proj_filter_block" as const;
export const PROJECT_MODAL_FILTER_ACTION_ID = "proj_filter_status" as const;

export const PROJECT_MODAL_PAGE_ACTIONS_BLOCK_ID = "proj_page_actions" as const;
export const PROJECT_MODAL_PAGE_PREV_ACTION_ID = "proj_page_prev" as const;
export const PROJECT_MODAL_PAGE_NEXT_ACTION_ID = "proj_page_next" as const;

export type ProjectModalFilter = "todas" | "pendentes" | "concluidas";

type TaskItem = {
  id: string;
  title: string;
  responsible: string;
  term: Date | null;
  status: string; // "done" | "open" | ...
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeTitle24(s: string) {
  const t = (s || "Projeto").trim();
  return (t.length ? t : "Projeto").slice(0, 24);
}

function formatDateBR(d: Date | null) {
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
}

function progressBar(done: number, total: number, size = 12) {
  if (total <= 0) return { bar: "░".repeat(size), perc: 0 };
  const perc = Math.round((done / total) * 100);
  const filled = clamp(Math.round((perc / 100) * size), 0, size);
  const bar = "▓".repeat(filled) + "░".repeat(size - filled);
  return { bar, perc };
}

function filterLabel(filter: ProjectModalFilter) {
  if (filter === "pendentes") return "⏳ Pendentes";
  if (filter === "concluidas") return "✅ Concluídas";
  return "📋 Todas";
}

function statusLabel(status: string) {
  return status === "done" ? "Concluído" : "Pendente";
}

function statusEmoji(status: string) {
  return status === "done" ? "✅" : "⏳";
}

export function projectViewModalView(args: {
  projectId: string;
  projectName: string;
  stats: { open: number; done: number; overdue: number };
  tasks: TaskItem[];
  page: number;
  totalPages: number;
  filter: ProjectModalFilter;
}): View {
  const total = args.stats.open + args.stats.done;
  const { bar, perc } = progressBar(args.stats.done, total);

  const headerBlocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${args.projectName}*\n` +
          `🆔 ID: \`${args.projectId}\`\n` +
          `✅ Concluídas: *${args.stats.done}*\n` +
          `⏳ Abertas: *${args.stats.open}*\n` +
          `⚠️ Atrasadas: *${args.stats.overdue}*`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `Progresso: ${bar} *${perc}%*` },
    },
    { type: "divider" },
  ];

  const filterSelect: StaticSelect = {
    type: "static_select",
    action_id: PROJECT_MODAL_FILTER_ACTION_ID,
    placeholder: { type: "plain_text", text: "Filtrar tarefas" },
    options: [
      { text: { type: "plain_text", text: "📋 Todas" }, value: "todas" },
      { text: { type: "plain_text", text: "⏳ Pendentes" }, value: "pendentes" },
      { text: { type: "plain_text", text: "✅ Concluídas" }, value: "concluidas" },
    ],
    initial_option: {
      text: { type: "plain_text", text: filterLabel(args.filter) },
      value: args.filter,
    },
  };

  const filterBlock: ActionsBlock = {
    type: "actions",
    block_id: PROJECT_MODAL_FILTER_BLOCK_ID,
    elements: [filterSelect as unknown as ActionsBlockElement],
  };

  const tasksBlocks: KnownBlock[] = args.tasks.length
    ? args.tasks.map((t) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `${statusEmoji(t.status)} *${t.title}*\n` +
            `Resp.: <@${t.responsible}> • Prazo: ${formatDateBR(t.term)} • Status: ${statusLabel(t.status)}`,
        },
      }))
    : [{ type: "section", text: { type: "mrkdwn", text: "_Nenhuma tarefa nesse filtro._" } }];

  const pageControls: KnownBlock[] = (() => {
    if (args.totalPages <= 1) return [];

    const elements: ActionsBlockElement[] = [];

    if (args.page > 1) {
      const prevBtn: Button = {
        type: "button",
        text: { type: "plain_text", text: "◀️ Anterior" },
        action_id: PROJECT_MODAL_PAGE_PREV_ACTION_ID,
        value: "prev",
      };
      elements.push(prevBtn as unknown as ActionsBlockElement);
    }

    if (args.page < args.totalPages) {
      const nextBtn: Button = {
        type: "button",
        text: { type: "plain_text", text: "Próximo ▶️" },
        action_id: PROJECT_MODAL_PAGE_NEXT_ACTION_ID,
        value: "next",
      };
      elements.push(nextBtn as unknown as ActionsBlockElement);
    }

    const actions: ActionsBlock = {
      type: "actions",
      block_id: PROJECT_MODAL_PAGE_ACTIONS_BLOCK_ID,
      elements,
    };

    const ctx: ContextBlock = {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Página *${args.page}* de *${args.totalPages}* • Filtro: *${filterLabel(args.filter)}*`,
        } as MrkdwnElement,
      ],
    };

    return [actions as unknown as KnownBlock, ctx as unknown as KnownBlock];
  })();

  return {
    type: "modal",
    callback_id: PROJECT_VIEW_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      projectId: args.projectId,
      page: args.page,
      filter: args.filter,
    }),
    title: { type: "plain_text", text: safeTitle24(args.projectName) },
    close: { type: "plain_text", text: "Fechar" },
    blocks: [...headerBlocks, filterBlock as unknown as KnownBlock, { type: "divider" }, ...tasksBlocks, ...pageControls],
  };
}
