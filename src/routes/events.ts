// src/slack/routes/events.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import { publishHome } from "../services/publishHome";

export async function events(app: FastifyInstance, slack: WebClient) {
  app.post("/events", async (req, reply) => {
    const body = req.body as any;

    // 1) Slack URL verification (challenge)
    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    // 2) Events
    if (body?.type === "event_callback") {
      const event = body.event;

      if (event?.type === "app_home_opened") {
        try {
          await publishHome(slack, event.user);
        } catch (err) {
          req.log.error(err);
        }
      }
    }

    // ACK sempre
    return reply.status(200).send();
  });
}
