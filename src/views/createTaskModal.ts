import type { ModalView } from "@slack/web-api";

export const CREATE_TASK_MODAL_CALLBACK_ID = "create_task_modal" as const;

export function createTaskModalView(): ModalView {
  return {
    type: "modal",
    callback_id: CREATE_TASK_MODAL_CALLBACK_ID,

    title: { type: "plain_text", text: "Criar tarefa" },
    submit: { type: "plain_text", text: "Criar" },
    close: { type: "plain_text", text: "Cancelar" },

    blocks: [
      {
        type: "input",
        block_id: "title_block",
        label: { type: "plain_text", text: "Título" },
        element: { type: "plain_text_input", action_id: "title" },
      },
      {
        type: "input",
        optional: true,
        block_id: "desc_block",
        label: { type: "plain_text", text: "Descrição" },
        element: {
          type: "plain_text_input",
          action_id: "description",
          multiline: true,
        },
      },
      {
        type: "input",
        block_id: "resp_block",
        label: { type: "plain_text", text: "Responsável" },
        element: { type: "users_select", action_id: "responsible" },
      },
      {
        type: "input",
        block_id: "due_block",
        label: { type: "plain_text", text: "Prazo" },
        element: { type: "datepicker", action_id: "due_date" },
      },
      {
        type: "input",
        block_id: "urgency_block",
        label: { type: "plain_text", text: "Nível de urgência" },
        element: {
          type: "static_select",
          action_id: "urgency",
          options: [
            { text: { type: "plain_text", text: "🟢 Light" }, value: "light" },
            { text: { type: "plain_text", text: "🟡 ASAP" }, value: "asap" },
            { text: { type: "plain_text", text: "🔴 Turbo" }, value: "turbo" },
          ],
        },
      },
      {
        type: "input",
        optional: true,
        block_id: "cc_block",
        label: { type: "plain_text", text: "Pessoas em cópia" },
        element: { type: "multi_users_select", action_id: "carbon_copies" },
      },
    ],
  };
}
