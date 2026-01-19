// src/slack/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { WebClient } from "@slack/web-api";

import {
  createTaskModalView,
  CREATE_TASK_MODAL_CALLBACK_ID,
} from "../views/createTaskModal";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";

import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
  console.log("[INTERACTIVE] HIT", new Date().toISOString());
  console.log("[INTERACTIVE] headers", req.headers);
  console.log("[INTERACTIVE] raw body", req.body);
  return reply.status(200).send();
});

}
