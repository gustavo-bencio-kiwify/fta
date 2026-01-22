// src/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import formbody from "@fastify/formbody";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";

import {
  createTaskModalView,
  CREATE_TASK_MODAL_CALLBACK_ID,
  TASK_TIME_BLOCK_ID,
  TASK_TIME_ACTION_ID,
  TASK_RECURRENCE_BLOCK_ID,
  TASK_RECURRENCE_ACTION_ID,
  TASK_PROJECT_BLOCK_ID,
  TASK_PROJECT_ACTION_ID,
} from "../views/createTaskModal";

import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import { createTaskService } from "../services/createTaskService";
import { prisma } from "../lib/prisma";

type SlackPayload = any;

function parseSlackPayload(body: any): SlackPayload | null {
  if (!body) return null;
  if (typeof body.payload === "string") {
    try {
      return JSON.parse(body.payload);
    } catch {
      return null;
    }
  }
  return body.payload ?? null;
}

// Helpers modal
function getInputValue(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.value;
}
function getSelectedUser(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_user;
}
function getSelectedDate(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_date; // "YYYY-MM-DD"
}
function getSelectedTime(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_time; // "HH:MM"
}
function getSelectedOptionValue(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_option?.value;
}
function getSelectedUsers(values: any, blockId: string, actionId: string): string[] {
  return values?.[blockId]?.[actionId]?.selected_users ?? [];
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const payload = parseSlackPayload(req.body);
      if (!payload) return reply.status(200).send();

      const userId = payload.user?.id as string | undefined;

      // =========================
      // 0) BLOCK SUGGESTION (external_select: projetos)
      // =========================
      if (payload.type === "block_suggestion") {
        const query = (payload.value ?? "").toString().trim();

        // o action_id pode vir em payload.action_id (Slack) ou em payload.actions[0]
        const actionId =
          payload.action_id ??
          payload.action?.action_id ??
          payload.actions?.[0]?.action_id;

        if (actionId !== TASK_PROJECT_ACTION_ID) {
          return reply.status(200).send({ options: [] });
        }

        const projects = await prisma.project.findMany({
          where: query
            ? { name: { contains: query, mode: "insensitive" } }
            : undefined,
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, name: true },
        });

        return reply.status(200).send({
          options: projects.map((p) => ({
            text: { type: "plain_text", text: p.name },
            value: p.id, // ✅ projectId
          })),
        });
      }

      // =========================
      // 1) BLOCK ACTIONS (botões)
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView(),
          });
          return reply.status(200).send();
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: sendBatchModalView(),
          });
          return reply.status(200).send();
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createProjectModalView(),
          });
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================
      // 2) VIEW SUBMISSION (submit do modal)
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;

        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();

          const descriptionRaw = getInputValue(values, "desc_block", "description");
          const description = descriptionRaw?.trim() ? descriptionRaw.trim() : undefined;

          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";

          const dueDate = getSelectedDate(values, "due_block", "due_date"); // YYYY-MM-DD | undefined
          const deadlineTime = getSelectedTime(values, TASK_TIME_BLOCK_ID, TASK_TIME_ACTION_ID); // HH:MM | undefined

          const recurrence = getSelectedOptionValue(values, TASK_RECURRENCE_BLOCK_ID, TASK_RECURRENCE_ACTION_ID); // daily.. | undefined
          const projectId = getSelectedOptionValue(values, TASK_PROJECT_BLOCK_ID, TASK_PROJECT_ACTION_ID); // uuid | undefined

          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";

          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!userId) return reply.send({});
          if (!title || !responsible) return reply.send({});

          await createTaskService({
            title,
            description,
            delegation: userId,
            responsible,
            term: dueDate ?? null,
            deadlineTime: deadlineTime ?? null,
            recurrence: recurrence ?? null,
            projectId: projectId ?? null,
            urgency,
            carbonCopies,
          });

          return reply.send({}); // fecha modal
        }

        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          return reply.send({});
        }

        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error({ err }, "[INTERACTIVE] error");
      return reply.status(200).send();
    }
  });
}
