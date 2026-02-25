// src/slack/views/createProjectModal.ts
import type { ModalView } from "@slack/web-api";

export const CREATE_PROJECT_MODAL_CALLBACK_ID = "create_project_modal" as const;

export const PROJECT_NAME_BLOCK_ID = "project_name_block" as const;
export const PROJECT_NAME_ACTION_ID = "project_name" as const;

export const PROJECT_DESC_BLOCK_ID = "project_desc_block" as const;
export const PROJECT_DESC_ACTION_ID = "project_desc" as const;

export const PROJECT_END_BLOCK_ID = "project_end_block" as const;
export const PROJECT_END_ACTION_ID = "project_end" as const;

export const PROJECT_MEMBERS_BLOCK_ID = "project_members_block" as const;
export const PROJECT_MEMBERS_ACTION_ID = "project_members" as const;

type CreateProjectModalMode = "create" | "edit";

type CreateProjectModalViewParams = {
  mode?: CreateProjectModalMode;
  projectId?: string;
  initialName?: string;
  initialDescription?: string | null;
  initialEndDateIso?: string | null; // YYYY-MM-DD
  initialMemberSlackIds?: string[];
};

export function createProjectModalView(
  params: CreateProjectModalViewParams = {}
): ModalView {
  const mode = params.mode ?? "create";

  const initialName = params.initialName ?? "";
  const initialDescription = params.initialDescription ?? "";
  const initialEndDateIso = params.initialEndDateIso ?? null;
  const initialMemberSlackIds = params.initialMemberSlackIds ?? [];

  return {
    type: "modal",
    callback_id: CREATE_PROJECT_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      mode,
      projectId: params.projectId ?? null,
    }),
    title: {
      type: "plain_text",
      text: mode === "edit" ? "Editar Projeto" : "Novo Projeto",
    },
    submit: {
      type: "plain_text",
      text: mode === "edit" ? "Salvar" : "Criar",
    },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "input",
        block_id: PROJECT_NAME_BLOCK_ID,
        label: { type: "plain_text", text: "Nome do projeto" },
        element: {
          type: "plain_text_input",
          action_id: PROJECT_NAME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Write something" },
          ...(initialName ? { initial_value: initialName } : {}),
        },
      },
      {
        type: "input",
        block_id: PROJECT_DESC_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Descrição (opcional)" },
        element: {
          type: "plain_text_input",
          action_id: PROJECT_DESC_ACTION_ID,
          multiline: true,
          placeholder: { type: "plain_text", text: "Write something" },
          ...(initialDescription ? { initial_value: initialDescription } : {}),
        },
      },
      {
        type: "input",
        block_id: PROJECT_END_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Data final (prazo do projeto) (opcional)" },
        element: {
          type: "datepicker",
          action_id: PROJECT_END_ACTION_ID,
          placeholder: { type: "plain_text", text: "Selecione uma data" },
          ...(initialEndDateIso ? { initial_date: initialEndDateIso } : {}),
        },
      },
      {
        type: "input",
        block_id: PROJECT_MEMBERS_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Membros com acesso" },
        element: {
          type: "multi_users_select",
          action_id: PROJECT_MEMBERS_ACTION_ID,
          placeholder: { type: "plain_text", text: "Selecione usuários" },
          ...(initialMemberSlackIds.length
            ? { initial_users: initialMemberSlackIds }
            : {}),
        },
      },
    ],
  } as ModalView;
}