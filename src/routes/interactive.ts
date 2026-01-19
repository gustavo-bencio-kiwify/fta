// src/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import formbody from "@fastify/formbody";

import { publishHome } from "../services/publishHome";
import { createTaskService } from "../services/createTaskService";

import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID } from "../views/createTaskModal";
import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions"; // ou "../views/homeView" se seus actionIds estiverem lá

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload = JSON.parse(body.payload);

      // ===== 1) Clique em botões (Home / Blocks)
      if (payload.type === "block_actions") {
        const actionId = payload.actions?.[0]?.action_id as string | undefined;

        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView(),
          });
          return reply.status(200).send();
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: sendBatchModalView(),
          });
          return reply.status(200).send();
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createProjectModalView(),
          });
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // ===== 2) Submit do modal: criar tarefa
      if (payload.type === "view_submission" && payload.view?.callback_id === CREATE_TASK_MODAL_CALLBACK_ID) {
        const values = payload.view.state.values;

        const title = values.title_block.title.value as string;
        const description = values.desc_block?.description?.value as string | undefined;

        const responsible = values.resp_block.responsible.selected_user as string;
        const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

        const urgency = values.urgency_block.urgency.selected_option.value as "light" | "asap" | "turbo";

        const carbonCopies =
          (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

        await createTaskService({
          title,
          description,
          delegation: payload.user.id, // quem criou
          responsible,
          term: dueDate ?? null, // string YYYY-MM-DD ou null
          urgency,
          recurrence: "none",
          carbonCopies,
        });

        // Atualiza a Home depois de criar
        await publishHome(slack, payload.user.id);

        // fecha modal
        return reply.send({});
      }

      // ===== 3) Submit do modal: lote (placeholder)
      if (payload.type === "view_submission" && payload.view?.callback_id === SEND_BATCH_MODAL_CALLBACK_ID) {
        // TODO implementar
        await publishHome(slack, payload.user.id);
        return reply.send({});
      }

      // ===== 4) Submit do modal: projeto (placeholder)
      if (payload.type === "view_submission" && payload.view?.callback_id === CREATE_PROJECT_MODAL_CALLBACK_ID) {
        // TODO implementar
        await publishHome(slack, payload.user.id);
        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error(err);
      // Slack precisa de ACK rápido mesmo em erro
      return reply.status(200).send();
    }
  });
}
