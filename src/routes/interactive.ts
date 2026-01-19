// src/slack/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { WebClient } from "@slack/web-api";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";

import {
  createTaskModalView,
  CREATE_TASK_MODAL_CALLBACK_ID,
} from "../views/createTaskModal";

import {
  sendBatchModalView,
  SEND_BATCH_MODAL_CALLBACK_ID,
} from "../views/sendBatchModal";

import {
  createProjectModalView,
  CREATE_PROJECT_MODAL_CALLBACK_ID,
} from "../views/createProjectModal";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;

      // Slack manda x-www-form-urlencoded com "payload"
      const payloadRaw = body?.payload;
      if (!payloadRaw) {
        req.log.warn({ body }, "[INTERACTIVE] missing payload");
        return reply.status(200).send(); // ACK mesmo assim
      }

      const payload = JSON.parse(payloadRaw);

      // 🔥 LOG principal (pra você ver no Render)
      req.log.info(
        {
          type: payload.type,
          user: payload.user?.id,
          action_id: payload.actions?.[0]?.action_id,
          callback_id: payload.view?.callback_id,
        },
        "[INTERACTIVE] received"
      );

      // =========================
      // 1) CLICK em botões (Home)
      // =========================
      if (payload.type === "block_actions") {
        const actionId = payload.actions?.[0]?.action_id as string | undefined;

        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView(),
          });
          return reply.status(200).send(); // ACK
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: sendBatchModalView(),
          });
          return reply.status(200).send(); // ACK
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createProjectModalView(),
          });
          return reply.status(200).send(); // ACK
        }

        return reply.status(200).send(); // ACK padrão
      }

      // =========================
      // 2) SUBMIT do modal
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        const userId = payload.user?.id as string;

        // ✅ CREATE TASK MODAL
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = values.title_block?.title?.value as string | undefined;
          const description = values.desc_block?.description?.value as string | undefined;

          const responsible = values.resp_block?.responsible?.selected_user as string | undefined;
          const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

          const urgency = values.urgency_block?.urgency?.selected_option?.value as
            | "light"
            | "asap"
            | "turbo"
            | undefined;

          const carbonCopies =
            (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

          // ✅ validações rápidas (pra evitar parse dar erro “mudo”)
          const fieldErrors: Record<string, string> = {};
          if (!title) fieldErrors["title_block"] = "Informe um título.";
          if (!responsible) fieldErrors["resp_block"] = "Selecione um responsável.";
          if (!urgency) fieldErrors["urgency_block"] = "Selecione a urgência.";

          if (Object.keys(fieldErrors).length) {
            // Isso mantém o modal aberto e mostra erro nos campos
            return reply.send({
              response_action: "errors",
              errors: fieldErrors,
            });
          }

          try {
            // 🔥 LOG do que vai salvar
            req.log.info(
              {
                title,
                responsible,
                dueDate: dueDate ?? null,
                urgency,
                carbonCopiesCount: carbonCopies.length,
                delegation: userId,
              },
              "[INTERACTIVE] creating task"
            );

            await createTaskService({
              title,
              description,
              delegation: userId,
              responsible,
              term: dueDate ?? null,
              urgency,
              recurrence: "none",
              carbonCopies,
            });

            // atualiza a Home do usuário
            await publishHome(slack, userId);

            // ✅ fecha modal
            return reply.send({});
          } catch (err: any) {
            req.log.error({ err }, "[INTERACTIVE] createTaskService failed");

            // mantém modal aberto e mostra erro geral
            return reply.send({
              response_action: "errors",
              errors: {
                title_block: "Não foi possível salvar a tarefa (veja logs).",
              },
            });
          }
        }

        // outros modais
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          return reply.send({});
        }

        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          return reply.send({});
        }

        // callback desconhecido
        req.log.warn({ cb }, "[INTERACTIVE] unknown callback_id");
        return reply.send({});
      }

      return reply.status(200).send(); // ACK
    } catch (err) {
      req.log.error({ err }, "[INTERACTIVE] handler crash");
      return reply.status(200).send(); // ACK mesmo assim
    }
  });
}
