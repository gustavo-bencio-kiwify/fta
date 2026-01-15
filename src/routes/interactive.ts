import { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function interactive(app: FastifyInstance) {
  app.register(formbody);

  // =========================
  // INTERACTIVE (botões + modal)
  // =========================
  app.post("/interactive", async (req, reply) => {
    try {
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
                  label: { type: "plain_text", text: "Título" },
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
                  label: { type: "plain_text", text: "Responsável - Quem vai realizar a atividade?" },
                  element: {
                    type: "users_select",
                    action_id: "responsible",
                    placeholder: { type: "plain_text", text: "Selecione um usuário" },
                  },
                },

                // ✅ NOVO: Prazo (data)
                {
                  type: "input",
                  optional: true,
                  block_id: "due_block",
                  label: { type: "plain_text", text: "Prazo" },
                  element: {
                    type: "datepicker",
                    action_id: "due_date",
                    placeholder: { type: "plain_text", text: "Selecione uma data" },
                  },
                },

                // ✅ NOVO: Urgência (3 níveis)
                {
                  type: "input",
                  block_id: "urgency_block",
                  label: { type: "plain_text", text: "Nível de urgência" },
                  element: {
                    type: "static_select",
                    action_id: "urgency",
                    placeholder: { type: "plain_text", text: "Selecione" },
                    options: [
                      { text: { type: "plain_text", text: "🟢 Light" }, value: "light" },
                      { text: { type: "plain_text", text: "🟡 ASAP" }, value: "asap" },
                      { text: { type: "plain_text", text: "🔴 Turbo" }, value: "turbo" },
                    ],
                  },
                },

                // ✅ NOVO: Carbon copies (múltiplos usuários)
                {
                  type: "input",
                  optional: true,
                  block_id: "cc_block",
                  label: { type: "plain_text", text: "Pessoa em cópia - Selecione caso alguem precise acompanhar a atividade" },
                  element: {
                    type: "multi_users_select",
                    action_id: "carbon_copies",
                    placeholder: { type: "plain_text", text: "Selecione usuários (opcional)" },
                  },
                },
              ],
            },
          });
        }

        // ACK do Slack
        return reply.status(200).send();
      }

      // 2) Submit do modal
      if (payload.type === "view_submission") {
        if (payload.view.callback_id === "create_task_modal") {
          const values = payload.view.state.values;

          const title = values.title_block.title.value as string;
          const description = values.desc_block?.description?.value as string | undefined;
          const responsible = values.resp_block.responsible.selected_user as string;

          // ✅ Prazo (string YYYY-MM-DD ou undefined)
          const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

          // ✅ Urgência
          const urgency = values.urgency_block.urgency.selected_option.value as
            | "light"
            | "asap"
            | "turbo";

          // ✅ CC (array de Slack IDs)
          const carbonCopies = values.cc_block?.carbon_copies?.selected_users as string[] | undefined;

          console.log("MODAL SUBMIT:", {
            title,
            description,
            responsible,
            dueDate,
            urgency,
            carbonCopies,
          });

          // Se retornar {} o modal fecha
          return reply.send({});
        }
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error(err);
      return reply.status(200).send(); // ainda assim ACK pro Slack
    }
  });

  // =========================
  // EVENTS (Home tab)
  // =========================
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
        } catch (err) {
          req.log.error(err);
        }
      }
    }

    return reply.status(200).send();
  });
}
