// src/views/homeTasksBlocks.ts
import type { KnownBlock } from "@slack/web-api";

export type Urgency = "light" | "asap" | "turbo";

export type HomeTaskItem = {
  id: string;
  title: string;
  description?: string | null;
  delegation?: string | null;
  delegationName?: string | null; // ✅ novo (para exibir nome no plain_text)
  term?: Date | string | null;
  urgency: Urgency;
};

export type DelegatedTaskItem = {
  id: string;
  title: string;
  term?: Date | string | null;
  urgency: Urgency;
  responsible: string;
  responsibleName?: string | null; // ✅ novo
};

export type CcTaskItem = {
  id: string;
  title: string;
  term?: Date | string | null;
  urgency: Urgency;
  responsible: string;
  responsibleName?: string | null; // ✅ novo (CC mostra só responsável)
  delegation?: string | null;
  delegationName?: string | null;
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

function atName(nameOrNull?: string | null, fallbackId?: string | null) {
  const n = (nameOrNull ?? "").trim();
  if (n) return `@${n}`;
  const fb = (fallbackId ?? "").trim();
  return fb ? `@${fb}` : "";
}

/**
 * ✅ Render padrão com checkbox alinhado à esquerda:
 * - usa actions + checkboxes (texto em plain_text)
 * - description, se existir, vira context embaixo (cinza)
 */
function renderCheckboxRow(args: {
  blockId: string;
  taskId: string;
  line: string;
  description?: string | null;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "actions",
      block_id: args.blockId,
      elements: [
        {
          type: "checkboxes",
          action_id: TASK_SELECT_ACTION_ID,
          options: [
            {
              text: { type: "plain_text", text: args.line.slice(0, 150) }, // evita estourar
              value: args.taskId,
            },
          ],
        },
      ],
    } as KnownBlock,
  ];

  if (args.description?.trim()) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: args.description.trim().slice(0, 250) }],
    } as KnownBlock);
  }

  return blocks;
}

function myLine(t: HomeTaskItem) {
  const due = formatDateBR(t.term ?? null);
  const dueText = due ? ` (vence ${due})` : "";

  // ✅ no plain_text não existe mention real, então usamos @Nome
  const delegatedBy = t.delegationName
    ? ` — delegado por ${atName(t.delegationName, t.delegation ?? null)}`
    : t.delegation
      ? ` — delegado por ${atName(null, t.delegation)}`
      : "";

  return `${urgencyEmoji(t.urgency)} ${t.title}${dueText}${delegatedBy}`;
}

function delegatedLine(t: DelegatedTaskItem) {
  const due = formatDateBR(t.term ?? null);
  const dueText = due ? ` (vence ${due})` : "";

  const resp = atName(t.responsibleName ?? null, t.responsible);
  return `${urgencyEmoji(t.urgency)} ${t.title}${dueText} — responsável: ${resp}`;
}

function ccLineOnlyResponsible(t: CcTaskItem) {
  const due = formatDateBR(t.term ?? null);
  const dueText = due ? ` (vence ${due})` : "";

  const resp = atName(t.responsibleName ?? null, t.responsible);
  // ✅ CC: apenas responsável (sem delegado por)
  return `${urgencyEmoji(t.urgency)} ${t.title}${dueText} — responsável: ${resp}`;
}

function renderMyTaskItem(t: HomeTaskItem): KnownBlock[] {
  return renderCheckboxRow({
    blockId: `task_${t.id}`,
    taskId: t.id,
    line: myLine(t),
    description: t.description ?? null,
  });
}

function renderDelegatedItem(t: DelegatedTaskItem): KnownBlock[] {
  return renderCheckboxRow({
    blockId: `delegated_${t.id}`,
    taskId: t.id,
    line: delegatedLine(t),
  });
}

function renderCcItem(t: CcTaskItem): KnownBlock[] {
  // ✅ agora CC usa o mesmo padrão (actions + checkboxes) => alinhado igual os de cima
  return renderCheckboxRow({
    blockId: `cc_${t.id}`,
    taskId: t.id,
    line: ccLineOnlyResponsible(t),
  });
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
  } as KnownBlock);
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
      { type: "button", text: { type: "plain_text", text: "🔎 Ver detalhes" }, action_id: TASKS_VIEW_DETAILS_ACTION_ID, value: "details" },
      { type: "button", text: { type: "plain_text", text: "✏️ Editar" }, action_id: DELEGATED_EDIT_ACTION_ID, value: "edit" },
      { type: "button", text: { type: "plain_text", text: "❌ Cancelar" }, action_id: DELEGATED_CANCEL_ACTION_ID, value: "cancel" },
    ],
  } as KnownBlock);
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
      { type: "button", text: { type: "plain_text", text: "🔎 Ver detalhes" }, action_id: TASKS_VIEW_DETAILS_ACTION_ID, value: "details" },
    ],
  } as KnownBlock);
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
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhuma_" } } as KnownBlock);
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
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhum_" } } as KnownBlock);
  }

  return blocks;
}
