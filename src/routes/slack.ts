import { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function slackRoutes(app: FastifyInstance) {
  app.register(formbody);

  app.post("/slack/interactive", async (req, reply) => {
    const body = req.body as any;
    const payload = JSON.parse(body.payload);

    // 1) Clique no botão da Home
    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];

      if (action?.action_id === "home_create_task") {
        const triggerId = payload.trigger_id;

        await slack.views.open({
          trigger_id: triggerId,
          view: {
            type: "modal",
            callback_id: "create_task_modal",
            title: { type: "plain_text", text: "Criar tarefa" },
            submit: { type: "plain_text", text: "Criar" },
            close: { type: "plain_text", text: "Cancelar" },
            blocks: [
              {
                type: "input",
                block_id: "title_block",
                label: { type: "plain_text", text: "Nome" },
                element: {
                  type: "plain_text_input",
                  action_id: "title",
                  placeholder: { type: "plain_text", text: "Ex: Fechar relatório do mês" },
                },
              },
              {
                type: "input",
                optional: true,
                block_id: "desc_block",
                label: { type: "plain_text", text: "Descrição" },
                element: {
                  type: "plain_text_input",
                  action_id: "description",
                  multiline: true,
                  placeholder: { type: "plain_text", text: "Detalhes da tarefa..." },
                },
              },
              {
                type: "input",
                block_id: "resp_block",
                label: { type: "plain_text", text: "Responsável" },
                element: {
                  type: "users_select",
                  action_id: "responsible",
                  placeholder: { type: "plain_text", text: "Selecione um usuário" },
                },
              },
            ],
          },
        });
      }

      // ACK do Slack (sempre responda 200 rápido)
      return reply.status(200).send();
    }

    // 2) Submit do modal (quando clicar "Criar")
    if (payload.type === "view_submission") {
      if (payload.view.callback_id === "create_task_modal") {
        const values = payload.view.state.values;

        const title = values.title_block.title.value as string;
        const description = values.desc_block?.description?.value as string | undefined;
        const responsible = values.resp_block.responsible.selected_user as string;

        console.log("MODAL SUBMIT:", { title, description, responsible });

        // Aqui você vai:
        // - validar com Zod
        // - salvar no Prisma
        // - mandar DM no Slack etc.

        // Se retornar {} o modal fecha
        return reply.send({});
      }
    }

    return reply.status(200).send();
  });

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


