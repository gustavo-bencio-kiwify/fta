// src/views/feedbackModals.ts
import type { ModalView } from "@slack/web-api";

// ==============================
// IDs / Consts
// ==============================
export const FEEDBACK_CREATE_CALLBACK_ID = "feedback_create" as const;

export const FEEDBACK_TYPE_BLOCK_ID = "feedback_type_block" as const;
export const FEEDBACK_TITLE_BLOCK_ID = "feedback_title_block" as const;
export const FEEDBACK_DESC_BLOCK_ID = "feedback_desc_block" as const;

export const FEEDBACK_TYPE_SELECT_ACTION_ID = "feedback_type_select" as const;
export const FEEDBACK_TITLE_INPUT_ACTION_ID = "feedback_title" as const;
export const FEEDBACK_DESC_INPUT_ACTION_ID = "feedback_desc" as const;

// Modal de listagem
export const FEEDBACK_ADMIN_MODAL_CALLBACK_ID = "feedback_admin" as const;

export const FEEDBACK_ADMIN_FILTER_TYPE_BLOCK_ID = "feedback_filter_type_block" as const;
export const FEEDBACK_ADMIN_FILTER_STATUS_BLOCK_ID = "feedback_filter_status_block" as const;

export const FEEDBACK_ADMIN_FILTER_TYPE_ACTION_ID = "feedback_filter_type" as const;
export const FEEDBACK_ADMIN_FILTER_STATUS_ACTION_ID = "feedback_filter_status" as const;

// Botões de status (na listagem)
export const FEEDBACK_SET_REJECTED_ACTION_ID = "feedback_set_rejected" as const;
export const FEEDBACK_SET_WIP_ACTION_ID = "feedback_set_wip" as const;
export const FEEDBACK_SET_DONE_ACTION_ID = "feedback_set_done" as const;

// ✅ menu compacto (fica à direita do texto)
export const FEEDBACK_STATUS_MENU_ACTION_ID = "feedback_status_menu" as const;

// ==============================
// Types
// ==============================
export type FeedbackTypeFilter = "all" | "bug" | "suggestion";
export type FeedbackStatusFilter = "all" | "pending" | "wip" | "done" | "rejected";

export type FeedbackItem = {
  id: string;
  type: "bug" | "suggestion";
  title: string;
  description: string;
  status: "pending" | "wip" | "done" | "rejected";
  createdBySlackId: string;
  createdAt: Date;
  updatedAt: Date;
};

function labelType(t: FeedbackItem["type"]) {
  return t === "bug" ? "Bug" : "Sugestão";
}

function labelStatus(s: FeedbackItem["status"]) {
  switch (s) {
    case "pending":
      return "Pendente";
    case "wip":
      return "WIP";
    case "done":
      return "Concluído";
    case "rejected":
      return "Rejeitado";
    default:
      return s;
  }
}

function emojiType(t: FeedbackItem["type"]) {
  return t === "bug" ? "🐞" : "💡";
}

function emojiStatus(s: FeedbackItem["status"]) {
  switch (s) {
    case "pending":
      return "🟠";
    case "wip":
      return "🟡";
    case "done":
      return "🟢";
    case "rejected":
      return "🔴";
    default:
      return "";
  }
}

function truncate(s: string, max = 160) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function formatDate(d: Date) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * ✅ IMPORTANTE:
 * initial_option precisa ser UM DOS OBJETOS dentro de options
 */
function pickInitialOption<T extends { value: string }>(
  options: T[],
  value: string | undefined,
  fallback: string
) {
  const v = (value ?? fallback).trim();
  return options.find((o) => o.value === v) ?? options.find((o) => o.value === fallback) ?? options[0];
}

// ==============================
// Views
// ==============================

export function feedbackCreateModalView(): ModalView {
  const view: ModalView = {
    type: "modal",
    callback_id: FEEDBACK_CREATE_CALLBACK_ID,
    title: { type: "plain_text", text: "💡🐞Nova sugestão/Bug" },
    submit: { type: "plain_text", text: "Enviar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "input",
        block_id: FEEDBACK_TYPE_BLOCK_ID,
        label: { type: "plain_text", text: "Tipo" },
        element: {
          type: "static_select",
          action_id: FEEDBACK_TYPE_SELECT_ACTION_ID,
          options: [
            { text: { type: "plain_text", text: "🐞 Bug" }, value: "bug" },
            { text: { type: "plain_text", text: "💡 Sugestão" }, value: "suggestion" },
          ],
        },
      },
      {
        type: "input",
        block_id: FEEDBACK_TITLE_BLOCK_ID,
        label: { type: "plain_text", text: "Título" },
        element: {
          type: "plain_text_input",
          action_id: FEEDBACK_TITLE_INPUT_ACTION_ID,
          placeholder: { type: "plain_text", text: "Ex: Botão não abre modal" },
        },
      },
      {
        type: "input",
        block_id: FEEDBACK_DESC_BLOCK_ID,
        label: { type: "plain_text", text: "Descrição" },
        element: {
          type: "plain_text_input",
          action_id: FEEDBACK_DESC_INPUT_ACTION_ID,
          multiline: true,
          placeholder: { type: "plain_text", text: "Explique o que aconteceu / o que você esperava." },
        },
      },
    ] as any,
  };

  return view;
}

export function feedbackAdminModalView(args: {
  items: FeedbackItem[];
  typeFilter: FeedbackTypeFilter;
  statusFilter: FeedbackStatusFilter;
  /** tickets abertos criados pelo usuário (pending/wip) */
  myOpenItems?: FeedbackItem[];
  /** true => mostra controles de mudança de status */
  canEdit?: boolean;
}): ModalView {
  const { items, typeFilter, statusFilter, myOpenItems = [], canEdit = false } = args;

  const typeOptions = [
    { text: { type: "plain_text", text: ":clipboard: Todos" }, value: "all" },
    { text: { type: "plain_text", text: "🐞 Bug" }, value: "bug" },
    { text: { type: "plain_text", text: "💡 Sugestão" }, value: "suggestion" },
  ] as const;

  const statusOptions = [
    { text: { type: "plain_text", text: ":clipboard: Todos" }, value: "all" },
    { text: { type: "plain_text", text: "🟠 Pendente" }, value: "pending" },
    { text: { type: "plain_text", text: "🟡 WIP" }, value: "wip" },
    { text: { type: "plain_text", text: "🟢 Concluído" }, value: "done" },
    { text: { type: "plain_text", text: "🔴 Rejeitado" }, value: "rejected" },
  ] as const;

  const initialType = pickInitialOption([...typeOptions], typeFilter, "all");
  const initialStatus = pickInitialOption([...statusOptions], statusFilter, "all");

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "💡🐞*Bugs & Sugestões*  \nUse os filtros para refinar a lista." },
    },
  ];

  // ✅ Meus tickets abertos (sempre aparece pra todos)
  const mine = (myOpenItems ?? []).filter((x) => x && x.status !== "done" && x.status !== "rejected");
  if (mine.length) {
    const MAX_MINE = 10;
    const shown = mine.slice(0, MAX_MINE);

    const lines = shown.map((t) => {
      const st = t.status === "pending" ? "🟠" : "🟡"; // pending/wip
      return `• ${emojiType(t.type)} ${st} ${truncate(t.title, 70)}`;
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🧾 *Meus tickets abertos* (${mine.length})\n` +
          lines.join("\n") +
          (mine.length > MAX_MINE ? `\n_+${mine.length - MAX_MINE} outros…_` : ""),
      },
    });
    blocks.push({ type: "divider" });
  }

  // ✅ Filtros
  blocks.push(
    {
      type: "input",
      block_id: FEEDBACK_ADMIN_FILTER_TYPE_BLOCK_ID,
      dispatch_action: true,
      label: { type: "plain_text", text: "Tipo" },
      element: {
        type: "static_select",
        action_id: FEEDBACK_ADMIN_FILTER_TYPE_ACTION_ID,
        options: typeOptions,
        initial_option: initialType,
      },
    },
    {
      type: "input",
      block_id: FEEDBACK_ADMIN_FILTER_STATUS_BLOCK_ID,
      dispatch_action: true,
      label: { type: "plain_text", text: "Status" },
      element: {
        type: "static_select",
        action_id: FEEDBACK_ADMIN_FILTER_STATUS_ACTION_ID,
        options: statusOptions,
        initial_option: initialStatus,
      },
    },
    { type: "divider" }
  );

  // ⚠️ Slack: limite ~100 blocks por view
  const MAX_ITEMS = 45;
  const visible = (items ?? []).slice(0, MAX_ITEMS);

  if (!visible.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Nenhum item encontrado para os filtros selecionados._" },
    });
  } else {
    if ((items ?? []).length > MAX_ITEMS) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_Mostrando ${MAX_ITEMS} de ${(items ?? []).length} itens (limite do Slack)._` }],
      });
      blocks.push({ type: "divider" });
    }

    for (const f of visible) {
      const header = `*${truncate(f.title, 120)}*`;
      const meta = `${emojiType(f.type)} ${labelType(f.type)} • ${emojiStatus(f.status)} *${labelStatus(
        f.status
      )}* • <@${f.createdBySlackId}> • ${formatDate(new Date(f.createdAt))}`;
      const desc = truncate(f.description ?? "", 220);

      // ✅ Regra: se estiver Done, não mostra menu (não volta de status)
      const showMenu = canEdit && f.status !== "done";

      blocks.push(
        {
          type: "section",
          text: { type: "mrkdwn", text: `${header}\n_${meta}_\n${desc}` },
          ...(showMenu
            ? {
                accessory: {
                  type: "overflow",
                  action_id: FEEDBACK_STATUS_MENU_ACTION_ID,
                  options: [
                    { text: { type: "plain_text", text: "❌ Rejeitar" }, value: `${f.id}|rejected` },
                    { text: { type: "plain_text", text: "🛠️ WIP" }, value: `${f.id}|wip` },
                    { text: { type: "plain_text", text: "✅ Done" }, value: `${f.id}|done` },
                  ],
                },
              }
            : {}),
        },
        { type: "divider" }
      );
    }
  }

  const view: ModalView = {
    type: "modal",
    callback_id: FEEDBACK_ADMIN_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "Feedback" },
    close: { type: "plain_text", text: "Fechar" },
    private_metadata: JSON.stringify({ typeFilter, statusFilter }),
    blocks: blocks as any,
  };

  return view;
}