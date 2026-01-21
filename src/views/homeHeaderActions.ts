// src/slack/views/homeHeaderActions.ts
import type { AnyBlock } from "@slack/web-api";

export const HOME_CREATE_TASK_ACTION_ID = "home_create_task" as const;
export const HOME_SEND_BATCH_ACTION_ID = "home_send_batch" as const;
export const HOME_NEW_PROJECT_ACTION_ID = "home_new_project" as const;

export function homeHeaderActionsBlocks(): AnyBlock[] {
  return [
    { type: "header", text: { type: "plain_text", text: "FTA Kiwify" } },

    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "➕ Criar Tarefa" },
          action_id: HOME_CREATE_TASK_ACTION_ID,
          value: "create_task",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📤 Enviar atividades em lote" },
          action_id: HOME_SEND_BATCH_ACTION_ID,
          value: "send_batch",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📂 Criar Projeto" },
          action_id: HOME_NEW_PROJECT_ACTION_ID,
          value: "new_project",
        },
      ],
    },

    { type: "divider" },
  ];
}
