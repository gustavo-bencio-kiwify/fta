// src/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import formbody from "@fastify/formbody";

import {
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";

import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID } from "../views/createTaskModal";
import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import {
  TASK_SELECT_ACTION_ID,
  TASKS_CONCLUDE_SELECTED_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,
} from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";
import { notifyTaskCreated } from "../services/notifyTaskCreated";

type SlackPayload = any;

function getInputValue(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.value;
}
function getSelectedUser(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_user;
}
function getSelectedDate(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_date;
}
function getSelectedOptionValue(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_option?.value;
}
function getSelectedUsers(values: any, blockId: string, actionId: string): string[] {
  return values?.[blockId]?.[actionId]?.selected_users ?? [];
}

function extractSelectedTaskIds(payload: any): string[] {
  // slack manda state.values com selected_options
  const values = payload?.view?.state?.values ?? payload?.state?.values ?? {};
  const ids: string[] = [];

  for (const block of Object.values(values)) {
    for (const action of Object.values(block as any)) {
      if ((action as any)?.type === "checkboxes") {
        const selected = ((action as any).selected_options ?? []) as Array<{ value: string }>;
        for (const opt of selected) ids.push(opt.value);
      }
    }
  }

  // também pode vir diretamente em actions[0].selected_options em alguns casos
  const actionSelected = payload?.actions?.[0]?.selected_options as Array<{ value: string }> | undefined;
  if (actionSelected?.length) {
    for (const opt of actionSelected) ids.push(opt.value);
  }

  return Array.from(new Set(ids));
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload: SlackPayload =
        typeof body?.payload === "string" ? JSON.parse(body.payload) : body?.payload;

      if (!payload) return reply.status(200).send();

      const userId = payload.user?.id as string | undefined;

      // =========================
      // 1) BLOCK ACTIONS
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        // Botões de topo
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

        // checkbox (seleção): não faz nada sozinho, só deixa marcado
        if (actionId === TASK_SELECT_ACTION_ID) {
          return reply.status(200).send();
        }

        // botão: concluir selecionadas
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          const ids = extractSelectedTaskIds(payload);

          if (!ids.length) {
            // só refresca a home
            if (userId) await publishHome(slack, userId);
            return reply.status(200).send();
          }

          await prisma.task.deleteMany({
            where: { id: { in: ids } },
          });

          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // botão: atualizar
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================
      // 2) VIEW SUBMISSION
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;

        // Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();

          // ✅ descriptionRaw: não obrigatório
          const descriptionRaw = getInputValue(values, "desc_block", "description");
          const description = descriptionRaw ? descriptionRaw.trim() : undefined;

          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // YYYY-MM-DD | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          const createdBy = payload.user.id as string;

          // cria no banco
          const task = await createTaskService({
            title,
            description, // opcional
            delegation: createdBy,
            responsible,
            term: dueDate ?? null,
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          await notifyTaskCreated({
            slack,
            taskId: task.id,        // ✅ agora passa
            createdBy,
            taskTitle: title,
            responsible,
            carbonCopies,
          });

          // ✅ refresh home do criador e do responsável
          if (createdBy) await publishHome(slack, createdBy);
          if (responsible && responsible !== createdBy) await publishHome(slack, responsible);

          return reply.send({}); // fecha modal
        }

        // placeholders
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error({ err }, "[INTERACTIVE] error");
      return reply.status(200).send(); // Slack precisa 200
    }
  });
}
