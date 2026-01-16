import { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { WebClient } from "@slack/web-api";
import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID, } from "../views/createTaskModal";
import { HOME_CREATE_TASK_ACTION_ID, HOME_SEND_BATCH_ACTION_ID, HOME_NEW_PROJECT_ACTION_ID, } from "../views/homeView";
import { createTaskService } from "../services/createTaskService";
import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID, } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID, } from "../views/createProjectModal";


const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload = JSON.parse(body.payload);

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

      if (
        payload.type === "view_submission" &&
        payload.view?.callback_id === CREATE_TASK_MODAL_CALLBACK_ID
      ) {
        const values = payload.view.state.values;

        const title = values.title_block.title.value as string;
        const description = values.desc_block?.description?.value as string | undefined;

        const responsible = values.resp_block.responsible.selected_user as string;
        const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

        const urgency =
          values.urgency_block.urgency.selected_option.value as "light" | "asap" | "turbo";

        const carbonCopies =
          (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

        await createTaskService({
          title,
          description,
          delegation: payload.user.id, // quem criou
          responsible,
          term: dueDate ?? null,
          urgency,
          recurrence: "none",
          carbonCopies,
        });

        return reply.send({}); // fecha modal
      }

      // submit do modal: lote
      if (
        payload.type === "view_submission" &&
        payload.view?.callback_id === SEND_BATCH_MODAL_CALLBACK_ID
      ) {
        return reply.send({});
      }

      // submit do modal: projeto
      if (
        payload.type === "view_submission" &&
        payload.view?.callback_id === CREATE_PROJECT_MODAL_CALLBACK_ID
      ) {
        return reply.send({});
      }

      return reply.status(200).send(); // ACK
    } catch (err) {
      req.log.error(err);
      return reply.status(200).send(); // ACK mesmo assim
    }
  });
}
