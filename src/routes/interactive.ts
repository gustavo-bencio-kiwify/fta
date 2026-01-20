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

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";
import { notifyTaskCreated } from "../services/notifyTaskCreated";

// action_id do checkbox nas tasks (tem que bater com o que você colocou no homeTasksBlocks.ts)
const TASK_TOGGLE_DONE_ACTION_ID = "task_toggle_done" as const;

type SlackPayload = any;

// Helpers para extrair values do modal com segurança
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

export async function interactive(app: FastifyInstance, slack: WebClient) {
  // Slack manda x-www-form-urlencoded com payload=...
  app.register(formbody);


  app.post("/interactive", async (req, reply) => {
    // ACK rápido sempre
    try {
      req.log.info({ at: new Date().toISOString() }, "[INTERACTIVE] HIT");

      const body = req.body as any;
      const payload: SlackPayload =
        typeof body?.payload === "string" ? JSON.parse(body.payload) : body?.payload;
      const createdBy = payload.user.id;

      if (!payload) {
        req.log.warn({ body }, "[INTERACTIVE] missing payload");
        return reply.status(200).send();
      }

      // =========================
      // 1) BLOCK ACTIONS (botões, checkboxes)
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;
        const userId = payload.user?.id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // ---- Botões da Home
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

        // ---- Checkbox de concluir task
        if (actionId === TASK_TOGGLE_DONE_ACTION_ID) {
          // No seu homeTasksBlocks, você colocou options[0].value = taskId
          // Quando marca, o Slack manda selected_options com value(s)
          const selected = action?.selected_options as Array<{ value: string }> | undefined;
          const taskId = selected?.[0]?.value;

          req.log.info({ taskId, userId }, "[INTERACTIVE] checkbox toggle");

          if (taskId) {
            // Você precisa ter algum campo pra marcar como concluído.
            // Vou assumir que existe `done: boolean` e `doneAt: Date?`.
            // Se seu schema for diferente, me fala o modelo que eu ajusto.
            await prisma.task.delete({
              where: { id: taskId },
            });

            if (userId) {
              await publishHome(slack, userId);
            }
          }

          return reply.status(200).send();
        }

        // default ACK
        return reply.status(200).send();
      }

      // =========================
      // 2) VIEW SUBMISSION (submit de modal)
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        const userId = payload.user?.id as string | undefined;

        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // ---- Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = getInputValue(values, "title_block", "title") ?? "";
          const description = getInputValue(values, "desc_block", "description"); // opcional
          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          req.log.info(
            { title, responsible, dueDate, urgency, carbonCopiesCount: carbonCopies.length },
            "[INTERACTIVE] create_task parsed"
          );

          // delegator = quem submeteu o modal
          const delegation = userId ?? "";

          await createTaskService({
            title,
            description, // não obrigatória
            delegation: createdBy,
            responsible,
            term: dueDate ?? null,
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          await notifyTaskCreated({
            slack,
            createdBy,
            taskTitle: title,
            responsible,
            carbonCopies,
          });

          // Atualiza Home do criador
          if (userId) await publishHome(slack, userId);

          // (Opcional) Atualiza Home do responsável se for outro usuário
          if (responsible && responsible !== userId) {
            await publishHome(slack, responsible);
          }

          // Slack precisa de {} para fechar modal
          return reply.send({});
        }

        // ---- Lote (placeholder)
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          // implemente depois
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // ---- Projeto (placeholder)
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          // implemente depois
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        return reply.send({});
      }

      // default ACK
      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      // Slack precisa de 200 sempre, senão re-tenta
      return reply.status(200).send();
    }
  });
}
