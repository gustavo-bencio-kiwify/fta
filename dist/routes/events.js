"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.events = events;
const formbody_1 = __importDefault(require("@fastify/formbody"));
const web_api_1 = require("@slack/web-api");
const slack = new web_api_1.WebClient(process.env.SLACK_BOT_TOKEN);
async function events(app) {
    app.register(formbody_1.default);
    app.post("/events", async (req, reply) => {
        const body = req.body;
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
                }
                catch (err) {
                    console.log("views.publish error:", err);
                }
            }
        }
        return reply.status(200).send();
    });
}
