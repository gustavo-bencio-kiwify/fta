import type { ModalView } from "@slack/web-api";

export const CREATE_PROJECT_MODAL_CALLBACK_ID = "create_project_modal" as const;

export function createProjectModalView(): ModalView {
  return {
    type: "modal",
    callback_id: CREATE_PROJECT_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "Criar projeto" },
    submit: { type: "plain_text", text: "Criar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "input",
        block_id: "project_block",
        label: { type: "plain_text", text: "Nome do projeto" },
        element: {
          type: "plain_text_input",
          action_id: "project_name",
          placeholder: { type: "plain_text", text: "Ex: Projeto Financeiro" },
        },
      },
    ],
  };
}
