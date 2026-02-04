// src/views/editTaskModal.ts
import type { View } from "@slack/web-api";

export const EDIT_TASK_MODAL_CALLBACK_ID = "edit_task_modal" as const;

export const EDIT_TITLE_BLOCK_ID = "edit_title_block" as const;
export const EDIT_TITLE_ACTION_ID = "edit_title" as const;

export const EDIT_DESC_BLOCK_ID = "edit_desc_block" as const;
export const EDIT_DESC_ACTION_ID = "edit_desc" as const;

export const EDIT_TERM_BLOCK_ID = "edit_term_block" as const;
export const EDIT_TERM_ACTION_ID = "edit_term" as const;

export const EDIT_TIME_BLOCK_ID = "edit_time_block" as const;
export const EDIT_TIME_ACTION_ID = "edit_time" as const;

export const EDIT_RESP_BLOCK_ID = "edit_resp_block" as const;
export const EDIT_RESP_ACTION_ID = "edit_resp" as const;

export const EDIT_CC_BLOCK_ID = "edit_cc_block" as const;
export const EDIT_CC_ACTION_ID = "edit_cc" as const;

export const EDIT_RECURRENCE_BLOCK_ID = "edit_recurrence_block" as const;
export const EDIT_RECURRENCE_ACTION_ID = "edit_recurrence" as const;

type RecurrenceValue =
  | "none"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

function recurrenceLabel(v: RecurrenceValue) {
  switch (v) {
    case "none":
      return "Sem recorrência";
    case "daily":
      return "Diária";
    case "weekly":
      return "Semanal";
    case "biweekly":
      return "Quinzenal";
    case "monthly":
      return "Mensal";
    case "quarterly":
      return "Trimestral";
    case "semiannual":
      return "Semestral";
    case "annual":
      return "Anual";
    default:
      return v;
  }
}

export function editTaskModalView(args: {
  taskId: string;

  title: string;
  description?: string | null;

  currentDateIso?: string | null; // YYYY-MM-DD
  currentTime?: string | null; // HH:MM

  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
  recurrence: string | null; // pode vir "none" ou null
}): View {
  const recurrenceInitial: RecurrenceValue =
    (args.recurrence as RecurrenceValue) && args.recurrence !== "null"
      ? (args.recurrence as RecurrenceValue)
      : "none";

  const recurrenceOptions: RecurrenceValue[] = [
    "none",
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
  ];

  return {
    type: "modal",
    callback_id: EDIT_TASK_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ taskId: args.taskId }),
    title: { type: "plain_text", text: "Editar tarefa" },
    submit: { type: "plain_text", text: "Salvar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      // Título
      {
        type: "input",
        block_id: EDIT_TITLE_BLOCK_ID,
        element: {
          type: "plain_text_input",
          action_id: EDIT_TITLE_ACTION_ID,
          initial_value: args.title ?? "",
        },
        label: { type: "plain_text", text: "Título" },
      },

      // Descrição
      {
        type: "input",
        optional: true,
        block_id: EDIT_DESC_BLOCK_ID,
        element: {
          type: "plain_text_input",
          action_id: EDIT_DESC_ACTION_ID,
          multiline: true,
          initial_value: args.description ?? "",
        },
        label: { type: "plain_text", text: "Descrição" },
      },

      // Prazo (data)
      {
        type: "input",
        optional: true,
        block_id: EDIT_TERM_BLOCK_ID,
        element: {
          type: "datepicker",
          action_id: EDIT_TERM_ACTION_ID,
          initial_date: args.currentDateIso ?? undefined,
          placeholder: { type: "plain_text", text: "Sem prazo" },
        },
        label: { type: "plain_text", text: "Prazo (data)" },
      },

      // Horário
      {
        type: "input",
        optional: true,
        block_id: EDIT_TIME_BLOCK_ID,
        element: {
          type: "timepicker",
          action_id: EDIT_TIME_ACTION_ID,
          initial_time: args.currentTime ?? undefined,
          placeholder: { type: "plain_text", text: "Sem horário" },
        },
        label: { type: "plain_text", text: "Horário (opcional)" },
      },

      // Responsável
      {
        type: "input",
        block_id: EDIT_RESP_BLOCK_ID,
        element: {
          type: "users_select",
          action_id: EDIT_RESP_ACTION_ID,
          initial_user: args.responsibleSlackId,
          placeholder: { type: "plain_text", text: "Selecione o responsável" },
        },
        label: { type: "plain_text", text: "Responsável" },
      },

      // Pessoas em cópia
      {
        type: "input",
        optional: true,
        block_id: EDIT_CC_BLOCK_ID,
        element: {
          type: "multi_users_select",
          action_id: EDIT_CC_ACTION_ID,
          initial_users: Array.from(new Set(args.carbonCopiesSlackIds ?? [])).filter(Boolean),
          placeholder: { type: "plain_text", text: "Selecione pessoas em cópia" },
        },
        label: { type: "plain_text", text: "Pessoas em cópia" },
      },

      // Recorrência
      {
        type: "input",
        optional: true,
        block_id: EDIT_RECURRENCE_BLOCK_ID,
        element: {
          type: "static_select",
          action_id: EDIT_RECURRENCE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Sem recorrência" },
          initial_option: {
            text: { type: "plain_text", text: recurrenceLabel(recurrenceInitial) },
            value: recurrenceInitial,
          },
          options: recurrenceOptions.map((v) => ({
            text: { type: "plain_text", text: recurrenceLabel(v) },
            value: v,
          })),
        },
        label: { type: "plain_text", text: "Recorrência" },
      },
    ],
  };
}
