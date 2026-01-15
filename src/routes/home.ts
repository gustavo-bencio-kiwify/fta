import { FastifyInstance } from "fastify";
import { interactive } from "./interactive";
import { events } from "./events";

export async function homeRoutes(app: FastifyInstance) {
  // tudo que for registrado aqui dentro vai ficar sob /slack
  app.register(async function slackGroup(slackApp) {
    slackApp.register(interactive);
    slackApp.register(events);
  }, { prefix: "/slack" });
}
