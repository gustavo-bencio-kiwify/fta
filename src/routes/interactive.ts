import { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { WebClient } from "@slack/web-api";

import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID } from "../views/createTaskModal";
import { homeView, HOME_CREATE_TASK_ACTION_ID } from "../views/homeView";
import { createTaskService } from "../services/createTaskService";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function interactive(app: FastifyInstance) {
  app.register(formbody);

  // INTERACTIVITY (botões + modal)
  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload = JSON.parse(body.payload);

      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];

        if (action?.action_id === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView(),
          });
        }

        return reply.status(200).send(); // ACK
      }

      if (payload.type === "view_submission" && payload.view.callback_id === CREATE_TASK_MODAL_CALLBACK_ID) {
        const values = payload.view.state.values;

        const title = values.title_block.title.value as string;
        const description = values.desc_block?.description?.value as string | undefined;

        const responsible = values.resp_block.responsible.selected_user as string;
        const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

        const urgency = values.urgency_block.urgency.selected_option.value as string;

        const carbonCopies =
          (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

        await createTaskService({
          title,
          description,
          delegation: payload.user.id,
          responsible,
          term: dueDate ?? null,
          urgency,
          recurrence: "none",
          carbonCopies,
        });

        return reply.send({}); // fecha modal
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error(err);
      return reply.status(200).send(); // ACK mesmo assim
    }
  });

  // EVENTS (Home tab)
  app.post("/slack/events", async (req, reply) => {
    const body = req.body as any;

    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    if (body?.type === "event_callback") {
      const event = body.event;

      if (event?.type === "app_home_opened") {
        try {
          await slack.views.publish({
            user_id: event.user,
            view: homeView(),
          });
        } catch (err) {
          req.log.error(err);
        }
      }
    }

    return reply.status(200).send();
  });
}
