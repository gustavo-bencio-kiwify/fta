import { FastifyInstance } from "fastify";
import { WebClient } from "@slack/web-api";
import { interactive } from "./interactive";
import { events } from "./events";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function homeRoutes(app: FastifyInstance) {
app.register(interactive);
app.register(events)

}