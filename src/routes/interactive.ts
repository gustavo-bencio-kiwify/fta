import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { WebClient } from "@slack/web-api";

import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID } from "../views/createTaskModal";
import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions"; // ou homeView, conforme seu projeto

import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    // Slack manda application/x-www-form-urlencoded com body.payload
    const body = req.body as any;

    let payload: any;
    try {
      payload = JSON.parse(body.payload);
    } catch (e) {
      req.log.error({ body }, "[INTERACTIVE] payload JSON.parse failed");
      return reply.code(200).send(); // ACK
    }

    // Debug básico (deixa bem claro se está entrando no lugar certo)
    req.log.info(
      {
        type: payload.type,
        callback_id: payload.view?.callback_id,
        user: payload.user?.id,
      },
      "[INTERACTIVE] received"
    );

    try {
      // =====================
      // 1) Clique nos botões
      // =====================
      if (payload.type === "block_actions") {
        const actionId = payload.actions?.[0]?.action_id as string | undefined;

        req.log.info({ actionId }, "[INTERACTIVE] block_actions");

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

        return reply.code(200).send(); // ACK
      }

      // =====================
      // 2) Submit do modal: Criar Task
      // =====================
      if (payload.type === "view_submission" && payload.view?.callback_id === CREATE_TASK_MODAL_CALLBACK_ID) {
        const values = payload.view.state.values;

        // Extraindo valores
        const title = values.title_block?.title?.value as string | undefined;
        const description = values.desc_block?.description?.value as string | undefined;

        const responsible = values.resp_block?.responsible?.selected_user as string | undefined;
        const dueDate = values.due_block?.due_date?.selected_date as string | undefined; // "YYYY-MM-DD"

        const urgency = values.urgency_block?.urgency?.selected_option?.value as
          | "light"
          | "asap"
          | "turbo"
          | undefined;

        const carbonCopies =
          (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

        req.log.info(
          { title, responsible, dueDate, urgency, carbonCopiesCount: carbonCopies.length },
          "[INTERACTIVE] create_task_modal submit values"
        );

        // Validações mínimas (pra evitar salvar lixo e pra mostrar erro no modal)
        const errors: Record<string, string> = {};
        if (!title || !title.trim()) errors["title_block"] = "Informe um título.";
        if (!responsible) errors["resp_block"] = "Selecione um responsável.";
        if (!urgency) errors["urgency_block"] = "Selecione o nível de urgência.";

        if (Object.keys(errors).length > 0) {
          return reply.code(200).send({
            response_action: "errors",
            errors,
          });
        }

        // ✅ ACK rápido pro Slack fechar o modal
        reply.code(200).send({});

        // ✅ Faz a criação “em background” (evita timeout do Slack)
        void (async () => {
          try {
            const created = await createTaskService({
              title,
              description,
              delegation: payload.user.id, // quem criou
              responsible,
              term: dueDate ?? null,
              urgency,
              recurrence: "none",
              carbonCopies,
            });

            req.log.info({ taskId: created.id }, "[INTERACTIVE] task created in DB");

            // Atualiza a Home do usuário pra ele ver a tarefa aparecer
            await publishHome(slack, payload.user.id);

            req.log.info("[INTERACTIVE] home republished after create");
          } catch (err) {
            req.log.error(err, "[INTERACTIVE] createTaskService failed");
          }
        })();

        return; // já respondemos acima
      }

      // =====================
      // 3) Submit do modal: Lote
      // =====================
      if (payload.type === "view_submission" && payload.view?.callback_id === SEND_BATCH_MODAL_CALLBACK_ID) {
        // TODO: implementar
        return reply.code(200).send({});
      }

      // =====================
      // 4) Submit do modal: Projeto
      // =====================
      if (payload.type === "view_submission" && payload.view?.callback_id === CREATE_PROJECT_MODAL_CALLBACK_ID) {
        // TODO: implementar
        return reply.code(200).send({});
      }

      return reply.code(200).send(); // ACK padrão
    } catch (err) {
      req.log.error(err, "[INTERACTIVE] handler error");
      return reply.code(200).send(); // ACK mesmo assim
    }
  });
}
