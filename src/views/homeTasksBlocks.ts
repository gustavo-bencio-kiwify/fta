// src/views/homeTasksBlocks.ts
import type { KnownBlock } from "@slack/web-api";

export type Urgency = "light" | "asap" | "turbo";

export type HomeTaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string | null;
  term?: Date | string | null;
  urgency: Urgency;
};

export type DelegatedTaskItem = {
  id: string;
  title: string;
  term?: Date | string | null;
  urgency: Urgency;
  responsible: string;
};

export type CcTaskItem = {
  id: string;
  title: string;
  term?: Date | string | null;
  urgency: Urgency;
  responsible: string;
  delegation?: string | null;
};

export type RecurrenceItem = {
  id: string;
  title: string;
  recurrence: string;
};

export type ProjectItem = {
  id: string;
  name: string;
  openCount: number;
  doneCount: number;
  overdueCount: number;
};

export const TASK_SELECT_ACTION_ID = "task_select" as const;

export const TASKS_CONCLUDE_SELECTED_ACTION_ID = "tasks_conclude_selected" as const;
export const TASKS_SEND_QUESTION_ACTION_ID = "tasks_send_question" as const;
export const TASKS_RESCHEDULE_ACTION_ID = "tasks_reschedule" as const;
export const TASKS_VIEW_DETAILS_ACTION_ID = "tasks_view_details" as const;
export const TASKS_REFRESH_ACTION_ID = "tasks_refresh" as const;

// placeholders (sem funcionalidades ainda)
export const DELEGATED_SEND_FUP_ACTION_ID = "delegated_send_fup" as const;
export const DELEGATED_EDIT_ACTION_ID = "delegated_edit" as const;
export const DELEGATED_CANCEL_ACTION_ID = "delegated_cancel" as const;

export const CC_SEND_QUESTION_ACTION_ID = "cc_send_question" as const;

export const RECURRENCE_CANCEL_ACTION_ID = "recurrence_cancel" as const;

export const PROJECT_VIEW_ACTION_ID = "project_view" as const;
export const PROJECT_CREATE_TASK_ACTION_ID = "project_create_task" as const;
export const PROJECT_EDIT_ACTION_ID = "project_edit" as const;
export const PROJECT_CONCLUDE_ACTION_ID = "project_conclude" as const;

function urgencyEmoji(u: Urgency) {
  if (u === "light") return "🟢";
  if (u === "asap") return "🟡";
  return "🔴";
}

function formatDateBR(d?: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(dt);
}

function taskLineSameRow(t: {
  title: string;
  term?: Date | string | null;
  delegation?: string | null;
  responsible?: string | null;
  urgency: Urgency;
}) {
  const due = formatDateBR(t.term ?? null);
  const dueText = due ? ` (vence ${due})` : "";
  const delegatedText = t.delegation ? ` — delegado por <@${t.delegation}>` : "";
  const responsibleText = t.responsible ? ` — responsável: <@${t.responsible}>` : "";
  return `${urgencyEmoji(t.urgency)} *${t.title}*${dueText}${delegatedText}${responsibleText}`;
}

function renderMyTaskItem(t: HomeTaskItem): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      block_id: `task_${t.id}`,
      text: { type: "mrkdwn", text: taskLineSameRow(t) },
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [{ text: { type: "plain_text", text: " " }, value: t.id }],
      },
    },
  ];

  if (t.description?.trim()) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: t.description.trim() }],
    });
  }

  return blocks;
}

function renderDelegatedItem(t: DelegatedTaskItem): KnownBlock[] {
  const line = taskLineSameRow({
    title: t.title,
    term: t.term ?? null,
    urgency: t.urgency,
    responsible: t.responsible,
    delegation: null,
  });

  return [
    {
      type: "section",
      block_id: `delegated_${t.id}`,
      text: { type: "mrkdwn", text: line },
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [{ text: { type: "plain_text", text: " " }, value: t.id }],
      },
    },
  ];
}

function renderCcItem(t: CcTaskItem): KnownBlock[] {
  const line = taskLineSameRow({
    title: t.title,
    term: t.term ?? null,
    urgency: t.urgency,
    responsible: t.responsible,
    delegation: t.delegation ?? null,
  });

  return [
    {
      type: "section",
      block_id: `cc_${t.id}`,
      text: { type: "mrkdwn", text: line },
      accessory: {
        type: "checkboxes",
        action_id: TASK_SELECT_ACTION_ID,
        options: [{ text: { type: "plain_text", text: " " }, value: t.id }],
      },
    },
  ];
}

function renderGroup(title: string, blocksInside: KnownBlock[]): KnownBlock[] {
  return [
    ({ type: "section", text: { type: "mrkdwn", text: `*${title}:*` } } as KnownBlock),
    ...(blocksInside.length
      ? blocksInside
      : [({ type: "section", text: { type: "mrkdwn", text: "_Nenhuma_" } } as KnownBlock)]),
  ];
}

export function homeTasksBlocks(args: {
  // você é responsável
  tasksOverdue: HomeTaskItem[]; // (mantido no tipo por compatibilidade, mas não renderiza mais)
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];

  // você delegou
  delegatedToday: DelegatedTaskItem[];
  delegatedTomorrow: DelegatedTaskItem[];
  delegatedFuture: DelegatedTaskItem[];

  // você está em cópia
  ccToday: CcTaskItem[];
  ccTomorrow: CcTaskItem[];
  ccFuture: CcTaskItem[];

  // recorrências
  recurrences: RecurrenceItem[];

  // projetos
  projects: ProjectItem[];
}): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  const pushDivider = () => blocks.push({ type: "divider" });
  const pushHeader = (text: string) => blocks.push({ type: "header", text: { type: "plain_text", text } });
  const pushGroup = (title: string, listBlocks: KnownBlock[]) => blocks.push(...renderGroup(title, listBlocks));

  // =========================
  // SUAS TAREFAS (RESPONSÁVEL)
  // =========================
  pushHeader("📌 Suas tarefas (você é responsável)");
  // ✅ Removido "Atrasadas"
  pushGroup("Hoje", args.tasksToday.flatMap(renderMyTaskItem));
  pushDivider();
  pushGroup("Amanhã", args.tasksTomorrow.flatMap(renderMyTaskItem));
  pushDivider();
  pushGroup("Futuras", args.tasksFuture.flatMap(renderMyTaskItem));

  blocks.push({
    type: "actions",
    block_id: "my_tasks_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Concluir selecionadas" },
        action_id: TASKS_CONCLUDE_SELECTED_ACTION_ID,
        value: "conclude_selected",
      },
      { type: "button", text: { type: "plain_text", text: ":thread: Abrir thread" }, action_id: TASKS_SEND_QUESTION_ACTION_ID, value: "send_question" },
      { type: "button", text: { type: "plain_text", text: "📅 Reprogramar Prazo" }, action_id: TASKS_RESCHEDULE_ACTION_ID, value: "reschedule" },
      { type: "button", text: { type: "plain_text", text: "🔎 Ver detalhes" }, action_id: TASKS_VIEW_DETAILS_ACTION_ID, value: "details" },
    ],
  });
  pushDivider();

  // =========================
  // SUAS DEMANDAS (DELEGOU)
  // =========================
  pushHeader("📌 Suas demandas (você delegou)");
  pushGroup("Hoje", args.delegatedToday.flatMap(renderDelegatedItem));
  pushDivider();
  pushGroup("Amanhã", args.delegatedTomorrow.flatMap(renderDelegatedItem));
  pushDivider();
  pushGroup("Futuras", args.delegatedFuture.flatMap(renderDelegatedItem));

  blocks.push({
    type: "actions",
    block_id: "delegated_actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: ":thread: Abrir thread" }, action_id: TASKS_SEND_QUESTION_ACTION_ID, value: "send_question" },
      { type: "button", text: { type: "plain_text", text: "✅ Concluir selecionadas" }, action_id: TASKS_CONCLUDE_SELECTED_ACTION_ID, value: "conclude_selected" },
      { type: "button", text: { type: "plain_text", text: "✏️ Editar" }, action_id: DELEGATED_EDIT_ACTION_ID, value: "edit" },
      { type: "button", text: { type: "plain_text", text: "❌ Cancelar" }, action_id: DELEGATED_CANCEL_ACTION_ID, value: "cancel" },
    ],
  });
  pushDivider();

  // =========================
  // EM CÓPIA
  // =========================
  pushHeader("📌 Acompanhando (você está em cópia)");
  pushGroup("Hoje", args.ccToday.flatMap(renderCcItem));
  pushDivider();
  pushGroup("Amanhã", args.ccTomorrow.flatMap(renderCcItem));
  pushDivider();
  pushGroup("Futuras", args.ccFuture.flatMap(renderCcItem));

  blocks.push({
    type: "actions",
    block_id: "cc_actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: ":thread: Abrir thread" }, action_id: CC_SEND_QUESTION_ACTION_ID, value: "send_question" },
    ],
  });
  pushDivider();

  // =========================
  // RECORRÊNCIAS
  // =========================
  pushHeader("🔁 Suas recorrências");
  if (args.recurrences.length) {
    blocks.push(
      ...args.recurrences.flatMap((r) => [
        {
          type: "section",
          text: { type: "mrkdwn", text: `• ${r.title} — \`${r.recurrence}\`` },
          accessory: { type: "button", text: { type: "plain_text", text: "❌ Cancelar" }, action_id: RECURRENCE_CANCEL_ACTION_ID, value: r.id },
        } as KnownBlock,
      ])
    );
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhuma_" } });
  }
  pushDivider();

  // =========================
  // PROJETOS
  // =========================
  pushHeader("📁 Projetos que participo");
  if (args.projects.length) {
    blocks.push(
      ...args.projects.flatMap((p) => [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${p.name}*\n${p.openCount} abertas • ${p.doneCount} concluídas • ${p.overdueCount} atrasadas`,
          },
        } as KnownBlock,
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "👀 Ver" }, action_id: PROJECT_VIEW_ACTION_ID, value: p.id },
            { type: "button", text: { type: "plain_text", text: "➕ Criar Tarefa" }, action_id: PROJECT_CREATE_TASK_ACTION_ID, value: p.id },
            { type: "button", text: { type: "plain_text", text: "✏️ Editar" }, action_id: PROJECT_EDIT_ACTION_ID, value: p.id },
            { type: "button", text: { type: "plain_text", text: "✅ Concluir" }, action_id: PROJECT_CONCLUDE_ACTION_ID, value: p.id },
          ],
        } as KnownBlock,
      ])
    );
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhum_" } });
  }

  // ✅ PADDING MAIOR NO FINAL (pra não cortar os botões ao descer)
  const bottomPadBlocks: KnownBlock[] = Array.from({ length: 0 }).map((_, i) => ({
    type: "context",
    block_id: `bottom_pad_${i}`,
    elements: [{ type: "mrkdwn", text: " " }],
  })) as KnownBlock[];

  blocks.push(...bottomPadBlocks);

  return blocks;
}
