// src/routes/slackRoutes.ts
import type { FastifyInstance } from "fastify";
import { WebClient } from "@slack/web-api";
import { events } from "./events";
import { interactive } from "./interactive";
import { startTaskReminderScheduler } from "../services/taskReminderScheduler";

export async function slackRoutes(app: FastifyInstance) {
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  // ✅ inicia scheduler 1x por processo
  startTaskReminderScheduler(slack);

  app.register(
    async (slackApp) => {
      await events(slackApp, slack);
      await interactive(slackApp, slack);
    },
    { prefix: "/slack" }
  );
}
