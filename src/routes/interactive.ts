// src/routes/interactive.ts (ou src/slack/routes/interactive.ts)
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
  TASK_TOGGLE_DONE_ACTION_ID, // action_id do checkbox em cada task
  TASKS_CONCLUDE_SELECTED_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,
  TASKS_SEND_QUESTION_ACTION_ID,
  TASKS_RESCHEDULE_ACTION_ID,
  TASKS_VIEW_DETAILS_ACTION_ID,
} from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";
import { notifyTaskCreated } from "../services/notifyTaskCreated";

type SlackPayload = any;

// helpers modal
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

/**
 * ✅ pega TODOS os taskIds selecionados na Home
 * procurando pelos campos de checkbox com action_id = TASK_TOGGLE_DONE_ACTION_ID
 */
function extractSelectedTaskIdsFromHomeView(payload: SlackPayload): string[] {
  const values = payload?.view?.state?.values;
  if (!values || typeof values !== "object") return [];

  const ids: string[] = [];

  for (const blockId of Object.keys(values)) {
    const block = values[blockId];
    if (!block || typeof block !== "object") continue;

    for (const actionId of Object.keys(block)) {
      const actionState = block[actionId];

      // só considera nosso checkbox
      if (actionId !== TASK_TOGGLE_DONE_ACTION_ID) continue;

      const selected = actionState?.selected_options as Array<{ value: string }> | undefined;
      if (!selected?.length) continue;

      for (const opt of selected) {
        if (opt?.value) ids.push(opt.value);
      }
    }
  }

  // unique
  return Array.from(new Set(ids));
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    // ACK rápido SEMPRE
    try {
      req.log.info({ at: new Date().toISOString() }, "[INTERACTIVE] HIT");

      const body = req.body as any;
      const payload: SlackPayload =
        typeof body?.payload === "string" ? JSON.parse(body.payload) : body?.payload;

      if (!payload) {
        req.log.warn({ body }, "[INTERACTIVE] missing payload");
        return reply.status(200).send();
      }

      const userId = payload.user?.id as string | undefined; // quem clicou/submeteu

      // =========================
      // 1) BLOCK ACTIONS
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // --- botões do topo
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

        // --- checkbox: NÃO deleta, só ACK (seleção)
        if (actionId === TASK_TOGGLE_DONE_ACTION_ID) {
          // opcional: logar seleção atual
          const selectedIds = extractSelectedTaskIdsFromHomeView(payload);
          req.log.info({ selectedIds }, "[INTERACTIVE] checkbox selection changed");
          return reply.status(200).send();
        }

        // --- ✅ concluir selecionadas (deleta do banco)
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          const selectedIds = extractSelectedTaskIdsFromHomeView(payload);

          req.log.info({ selectedIdsCount: selectedIds.length, selectedIds }, "[INTERACTIVE] conclude selected");

          if (selectedIds.length && userId) {
            await prisma.task.deleteMany({
              where: {
                id: { in: selectedIds },
                responsible: userId, // extra segurança
              },
            });

            await publishHome(slack, userId);
          }

          return reply.status(200).send();
        }

        // --- refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // placeholders (ainda sem função)
        if (
          actionId === TASKS_SEND_QUESTION_ACTION_ID ||
          actionId === TASKS_RESCHEDULE_ACTION_ID ||
          actionId === TASKS_VIEW_DETAILS_ACTION_ID
        ) {
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

        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // --- criar task
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();
          const description = getInputValue(values, "desc_block", "description"); // opcional
          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          req.log.info(
            { title, hasDescription: !!description, responsible, dueDate, urgency, carbonCopiesCount: carbonCopies.length },
            "[INTERACTIVE] create_task parsed"
          );

          const createdBy = userId ?? "";

          const task = await createTaskService({
            title,
            description, // pode ser undefined
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
            taskId: task.id,
            taskTitle: task.title,
            description: task.description,
            responsible: task.responsible,
            urgency: task.urgency,
            term: task.term,
            carbonCopies: task.carbonCopies?.map((c: any) => c.slackUserId) ?? carbonCopies,
          });

          // atualiza home do criador
          if (userId) await publishHome(slack, userId);

          // atualiza home do responsável (se diferente)
          if (responsible && responsible !== userId) {
            await publishHome(slack, responsible);
          }

          return reply.send({}); // fecha modal
        }

        // --- lote
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // --- projeto
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      // ✅ aqui você finalmente vai ver erro real no Render
      req.log.error({ err, message: err?.message, stack: err?.stack }, "[INTERACTIVE] error");
      return reply.status(200).send();
    }
  });
}
