// src/slack/views/homeView.ts
import type { HomeView } from "@slack/web-api";

export const HOME_CREATE_TASK_ACTION_ID = "home_create_task" as const;

export function homeView(): HomeView {
  return {
    type: "home",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "FTA Kiwify" } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "➕ Criar Tarefa" },
            style: "primary",
            action_id: HOME_CREATE_TASK_ACTION_ID,
            value: "create_task",
          },
        ],
      },
    ],
  };
}
