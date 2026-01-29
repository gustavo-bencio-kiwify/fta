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

export function editTaskModalView(args: {
  taskId: string;
  title: string;
  description?: string | null;
  currentDateIso?: string | null; // YYYY-MM-DD
  currentTime?: string | null; // HH:MM
}): View {
  return {
    type: "modal",
    callback_id: EDIT_TASK_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ taskId: args.taskId }),
    title: { type: "plain_text", text: "Editar tarefa" },
    submit: { type: "plain_text", text: "Salvar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "input",
        block_id: EDIT_TITLE_BLOCK_ID,
        element: {
          type: "plain_text_input",
          action_id: EDIT_TITLE_ACTION_ID,
          initial_value: args.title ?? "",
        },
        label: { type: "plain_text", text: "Nome da tarefa" },
      },
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
    ],
  };
}
