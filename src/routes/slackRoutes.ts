// src/routes/slackRoutes.ts
import type { FastifyInstance } from "fastify";
import { WebClient } from "@slack/web-api";
import { events } from "./events";
import { interactive } from "./interactive";

export async function slackRoutes(app: FastifyInstance) {
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  // ✅ Reminders agora rodam via cron (startCrons) no boot do server.

  app.register(
    async (slackApp) => {
      await events(slackApp, slack);
      await interactive(slackApp, slack);
    },
    { prefix: "/slack" }
  );
}
