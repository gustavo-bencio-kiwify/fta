import { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function events(app: FastifyInstance) {
  app.register(formbody);

  app.post("/slack/events", async (req, reply) => {
  const body = req.body as any;

  // URL verification
  if (body?.type === "url_verification") {
    return reply.send({ challenge: body.challenge });
  }

  // Eventos
  if (body?.type === "event_callback") {
    const event = body.event;

    if (event?.type === "app_home_opened") {
      console.log("Home opened by:", event.user);

      try {
        await slack.views.publish({
          user_id: event.user,
          view: {
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
        action_id: "home_create_task",
        value: "create_task",
      },
    ],
  },
],

          },
        });

        console.log("Home published!");
      } catch (err) {
        console.log("views.publish error:", err);
      }
    }
  }

  return reply.status(200).send();
});

}


