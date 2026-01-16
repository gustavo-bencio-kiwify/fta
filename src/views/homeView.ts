// src/slack/views/homeView.ts
import type { HomeView } from "@slack/web-api";

export const HOME_CREATE_TASK_ACTION_ID = "home_create_task" as const;
export const HOME_SEND_BATCH_ACTION_ID = "home_send_batch" as const;
export const HOME_NEW_PROJECT_ACTION_ID = "home_new_project" as const;

export function homeView(): HomeView {
  return {
    type: "home",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "📋 Home" } },
      { type: "divider" },

      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: HOME_CREATE_TASK_ACTION_ID,
            text: { type: "plain_text", text: "➕ Criar Tarefa" },
            style: "primary",
            value: "create_task",
          },
          {
            type: "button",
            action_id: HOME_SEND_BATCH_ACTION_ID,
            text: { type: "plain_text", text: "📤 Enviar atividades em lote" },
            value: "send_batch",
          },
          {
            type: "button",
            action_id: HOME_NEW_PROJECT_ACTION_ID,
            text: { type: "plain_text", text: "📂 Criar Projeto" },
            value: "new_project",
          },
        ],
      },
    ],
  };
}
