// src/slack/views/createTaskModal.ts
import type { ModalView } from "@slack/web-api";

export const CREATE_TASK_MODAL_CALLBACK_ID = "create_task_modal" as const;

// IDs dos novos campos (pra bater com o interactive)
export const TASK_TIME_BLOCK_ID = "time_block" as const;
export const TASK_TIME_ACTION_ID = "deadline_time" as const;

export const TASK_RECURRENCE_BLOCK_ID = "recurrence_block" as const;
export const TASK_RECURRENCE_ACTION_ID = "recurrence" as const;

export const TASK_PROJECT_BLOCK_ID = "project_block" as const;
export const TASK_PROJECT_ACTION_ID = "project" as const;

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
        optional: true,
        block_id: "due_block",
        label: { type: "plain_text", text: "Prazo (data)" },
        element: { type: "datepicker", action_id: "due_date" },
      },

      // ✅ NOVO: horário (00:00 até 23:59)
      {
        type: "input",
        optional: true,
        block_id: TASK_TIME_BLOCK_ID,
        label: { type: "plain_text", text: "Horário do prazo" },
        element: {
          type: "timepicker",
          action_id: TASK_TIME_ACTION_ID,
          placeholder: { type: "plain_text", text: "Ex: 18:30" },
        },
      },

      // ✅ NOVO: recorrência (enum do seu banco)
      {
        type: "input",
        optional: true,
        block_id: TASK_RECURRENCE_BLOCK_ID,
        label: { type: "plain_text", text: "Recorrência" },
        element: {
          type: "static_select",
          action_id: TASK_RECURRENCE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Sem recorrência" },
          options: [
            { text: { type: "plain_text", text: "Diária" }, value: "daily" },
            { text: { type: "plain_text", text: "Semanal" }, value: "weekly" },
            { text: { type: "plain_text", text: "Quinzenal" }, value: "biweekly" },
            { text: { type: "plain_text", text: "Mensal" }, value: "monthly" },
            { text: { type: "plain_text", text: "Trimestral" }, value: "quarterly" },
            { text: { type: "plain_text", text: "Semestral" }, value: "semiannual" },
            { text: { type: "plain_text", text: "Anual" }, value: "annual" },
          ],
        },
      },

      // ✅ NOVO: projeto vindo do DB (external_select)
      {
        type: "input",
        optional: true,
        block_id: TASK_PROJECT_BLOCK_ID,
        label: { type: "plain_text", text: "Projeto" },
        element: {
          type: "external_select",
          action_id: TASK_PROJECT_ACTION_ID,
          placeholder: { type: "plain_text", text: "Buscar projeto..." },
          min_query_length: 0,
        },
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
