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
  description?: string | null; // ✅ novo
  term?: Date | string | null;
  urgency: Urgency;
  responsible: string;
  responsibleName?: string | null; // ✅ novo
};

export type CcTaskItem = {
  id: string;
  title: string;
  description?: string | null; // ✅ novo
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

// =========================
// ✅ Feedback (Home)
// =========================
export type FeedbackHomeItem = {
  id: string;
  type: "bug" | "suggestion";
  title: string;
  status: "pending" | "wip" | "done" | "rejected";
  updatedAt?: Date | string | null;
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
export const HOME_FEEDBACK_OPEN_ACTION_ID = "home_feedback_open" as const;
export const HOME_FEEDBACK_ADMIN_ACTION_ID = "home_feedback_admin" as const;

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

function escapeMrkdwn(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max = 70) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function feedbackTypeEmoji(t: FeedbackHomeItem["type"]) {
  return t === "bug" ? "🐞" : "💡";
}
function feedbackStatusEmoji(s: FeedbackHomeItem["status"]) {
  if (s === "pending") return "🟠";
  if (s === "wip") return "🟡";
  if (s === "done") return "🟢";
  return "🔴";
}
function feedbackStatusLabel(s: FeedbackHomeItem["status"]) {
  if (s === "pending") return "Pendente";
  if (s === "wip") return "WIP";
  if (s === "done") return "Concluído";
  return "Rejeitado";
}

/**
 * ✅ Deixa o texto do checkbox em duas linhas:
 * - Linha 1: o "line" principal
 * - Linha 2: descrição (se existir)
 */
function buildCheckboxText(line: string, description?: string | null) {
  const lineClean = (line ?? "").trim().replace(/\s+/g, " ");
  const descClean = (description ?? "").trim().replace(/\s+/g, " ");

  // limites "seguros"
  const LINE_MAX = 160;
  const TOTAL_MAX = 260;

  const lineTrunc = lineClean.slice(0, LINE_MAX);
  if (!descClean) return lineTrunc;

  const remaining = Math.max(0, TOTAL_MAX - (lineTrunc.length + 1));
  const descTrunc = descClean.slice(0, remaining);

  // coloca como 2ª linha
  return descTrunc ? `${lineTrunc}\n${descTrunc}` : lineTrunc;
}

/**
 * ✅ Render padrão com checkbox alinhado à esquerda:
 * - usa actions + checkboxes (texto em plain_text)
 * - description, se existir, vira 2ª linha do label
 */
function renderCheckboxRow(args: {
  blockId: string;
  taskId: string;
  line: string;
  description?: string | null;
}): KnownBlock[] {
  const text = buildCheckboxText(args.line, args.description);

  return [
    {
      type: "actions",
      block_id: args.blockId,
      elements: [
        {
          type: "checkboxes",
          action_id: TASK_SELECT_ACTION_ID,
          options: [
            {
              text: { type: "plain_text", text },
              value: args.taskId,
            },
          ],
        },
      ],
    } as KnownBlock,
  ];
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
    description: t.description ?? null,
  });
}

function renderCcItem(t: CcTaskItem): KnownBlock[] {
  return renderCheckboxRow({
    blockId: `cc_${t.id}`,
    taskId: t.id,
    line: ccLineOnlyResponsible(t),
    description: t.description ?? null,
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

function renderMyOpenFeedback(items: FeedbackHomeItem[]): KnownBlock[] {
  const MAX = 6;
  const visible = (items ?? []).slice(0, MAX);

  if (!visible.length) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Você não tem tickets abertos._" },
      } as KnownBlock,
    ];
  }

  const lines = visible.map((f) => {
    const title = escapeMrkdwn(truncate(f.title, 60));
    return `• ${feedbackTypeEmoji(f.type)} *${title}* — ${feedbackStatusEmoji(f.status)} ${feedbackStatusLabel(f.status)}`;
  });

  const suffix = (items?.length ?? 0) > MAX ? `\n_… e mais ${(items.length - MAX)}_` : "";

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") + suffix },
    } as KnownBlock,
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

  // ✅ feedback
  myOpenFeedback?: FeedbackHomeItem[];
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

  pushDivider();

  // =========================
  // BUGS / SUGESTÕES
  // =========================
  pushHeader("💡 Bugs e sugestões");

  // ✅ lista dos tickets que eu abri e ainda não concluí
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*Seus tickets abertos:*" },
  } as KnownBlock);
  blocks.push(...renderMyOpenFeedback(args.myOpenFeedback ?? []));

  const feedbackButtons: any[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "🐞 Enviar bug/sugestão" },
      action_id: HOME_FEEDBACK_OPEN_ACTION_ID,
      value: "open_feedback",
    },
    {
      type: "button",
      text: { type: "plain_text", text: "📋 Ver bugs/sugestões" },
      action_id: HOME_FEEDBACK_ADMIN_ACTION_ID,
      value: "view_feedback",
    },
  ];

  blocks.push({
    type: "actions",
    block_id: "feedback_actions",
    elements: feedbackButtons as any,
  } as KnownBlock);

  pushDivider();

  // ✅ PADDING MAIOR NO FINAL (pra não cortar os botões ao descer)
  const bottomPadBlocks: KnownBlock[] = Array.from({ length: 5 }).map((_, i) => ({
    type: "context",
    block_id: `bottom_pad_${i}`,
    elements: [{ type: "mrkdwn", text: " " }],
  })) as KnownBlock[];

  blocks.push(...bottomPadBlocks);

  return blocks;
}
