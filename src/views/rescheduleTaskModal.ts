// src/views/rescheduleTaskModal.ts
import type { View } from "@slack/web-api";

export const RESCHEDULE_TASK_MODAL_CALLBACK_ID = "reschedule_task_modal" as const;

export const RESCHEDULE_TERM_BLOCK_ID = "reschedule_term_block" as const;
export const RESCHEDULE_TERM_ACTION_ID = "reschedule_term" as const;

export const RESCHEDULE_TIME_BLOCK_ID = "reschedule_time_block" as const;
export const RESCHEDULE_TIME_ACTION_ID = "reschedule_time" as const;

export function rescheduleTaskModalView(args: {
  taskId: string;
  taskTitle: string;
  currentDateIso?: string | null; // YYYY-MM-DD
  currentTime?: string | null; // "HH:MM"
}): View {
  return {
    type: "modal",
    callback_id: RESCHEDULE_TASK_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "Reprogramar Prazo" },
    submit: { type: "plain_text", text: "Salvar" },
    close: { type: "plain_text", text: "Cancelar" },

    // ✅ guarda o taskId sem depender do estado do user
    private_metadata: JSON.stringify({ taskId: args.taskId }),

    blocks: [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `📋 Você está reprogramando a tarefa:\n*${args.taskTitle}*` }],
      },
      { type: "divider" },

      {
        type: "input",
        block_id: RESCHEDULE_TERM_BLOCK_ID,
        label: { type: "plain_text", text: "Novo prazo" },
        element: {
          type: "datepicker",
          action_id: RESCHEDULE_TERM_ACTION_ID,
          initial_date: args.currentDateIso ?? undefined,
        },
      },

      {
        type: "input",
        block_id: RESCHEDULE_TIME_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Horário (opcional)" },
        element: {
          type: "timepicker",
          action_id: RESCHEDULE_TIME_ACTION_ID,
          initial_time: args.currentTime ?? undefined,
        },
      },
    ],
  };
}
