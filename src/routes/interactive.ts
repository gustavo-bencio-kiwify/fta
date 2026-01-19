// src/slack/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { WebClient } from "@slack/web-api";

import {
  createTaskModalView,
  CREATE_TASK_MODAL_CALLBACK_ID,
} from "../views/createTaskModal";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";

import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    const raw = req.body as any;

    // Slack manda form-encoded com { payload: "json..." }
    const payload = raw?.payload ? JSON.parse(raw.payload) : raw;

    // LOG útil: tipo + callback/action
    req.log.info(
      {
        type: payload?.type,
        cb: payload?.view?.callback_id,
        action: payload?.actions?.[0]?.action_id,
      },
      "[INTERACTIVE] received"
    );

    try {
      // 1) Botões (Home)
      if (payload.type === "block_actions") {
        const actionId = payload.actions?.[0]?.action_id as string | undefined;

        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView(),
          });
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: sendBatchModalView(),
          });
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createProjectModalView(),
          });
        }

        // ✅ ACK rápido SEMPRE
        return reply.code(200).send();
      }

      // 2) Submit do modal de criar tarefa
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;

        // ✅ Se não for o modal certo, só fecha
        if (cb !== CREATE_TASK_MODAL_CALLBACK_ID &&
            cb !== SEND_BATCH_MODAL_CALLBACK_ID &&
            cb !== CREATE_PROJECT_MODAL_CALLBACK_ID) {
          req.log.warn({ cb }, "[INTERACTIVE] view_submission unknown callback_id");
          return reply.send({});
        }

        // ✅ IMPORTANTE: responder rápido pro Slack.
        // Vamos capturar os dados e salvar. Se der erro de validação, dá pra retornar errors no modal,
        // mas por enquanto vamos logar e fechar.
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          // helpers
          const get = (blockId: string, actionId: string) => values?.[blockId]?.[actionId];

          const title = get("title_block", "title")?.value as string;
          const description = get("desc_block", "description")?.value as string | undefined;

          const responsible = get("resp_block", "responsible")?.selected_user as string;

          const dueDate = get("due_block", "due_date")?.selected_date as string | undefined;

          const urgency = get("urgency_block", "urgency")?.selected_option?.value as
            | "light"
            | "asap"
            | "turbo";

          const carbonCopies =
            (get("cc_block", "carbon_copies")?.selected_users as string[] | undefined) ?? [];

          const delegation = payload.user?.id as string;

          // DEBUG: mostra exatamente o que chegou
          req.log.info(
            { title, description, responsible, dueDate, urgency, carbonCopies, delegation },
            "[INTERACTIVE] create_task submit values"
          );

          // Salva
          const created = await createTaskService({
            title,
            description,
            delegation,
            responsible,
            term: dueDate ?? null,
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          req.log.info({ id: created.id }, "[INTERACTIVE] task created");

          // Opcional: republish da home após criar
          // (isso é o que normalmente faz a task aparecer sem precisar reabrir)
          await publishHome(slack, delegation);

          // ✅ fecha modal
          return reply.send({});
        }

        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          req.log.info("[INTERACTIVE] send batch submit");
          return reply.send({});
        }

        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          req.log.info("[INTERACTIVE] create project submit");
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.code(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      // ✅ Slack exige 200 mesmo em erro (senão ele reenvia)
      return reply.code(200).send();
    }
  });
}
