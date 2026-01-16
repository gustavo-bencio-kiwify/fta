import type { ModalView } from "@slack/web-api";

export const SEND_BATCH_MODAL_CALLBACK_ID = "send_batch_modal" as const;

export function sendBatchModalView(): ModalView {
  return {
    type: "modal",
    callback_id: SEND_BATCH_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "Enviar em lote" },
    submit: { type: "plain_text", text: "Enviar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Em breve: envio de tarefas em lote." },
      },
    ],
  };
}
