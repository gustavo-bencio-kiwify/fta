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
  TASK_SELECT_ACTION_ID,
  TASKS_CONCLUDE_SELECTED_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,
} from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";
import { notifyTaskCreated } from "../services/notifyTaskCreated";

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
  return values?.[blockId]?.[actionId]?.selected_date;
}
function getSelectedOptionValue(values: any, blockId: string, actionId: string): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_option?.value;
}
function getSelectedUsers(values: any, blockId: string, actionId: string): string[] {
  return values?.[blockId]?.[actionId]?.selected_users ?? [];
}

// Pega TODOS taskIds selecionados na Home (checkbox accessory)
function getSelectedTaskIdsFromHome(payload: any): string[] {
  const stateValues = payload?.view?.state?.values;
  if (!stateValues) return [];

  const ids: string[] = [];

  for (const block of Object.values(stateValues)) {
    const action = (block as any)?.[TASK_SELECT_ACTION_ID];
    const selected = action?.selected_options as Array<{ value: string }> | undefined;
    if (selected?.length) {
      for (const opt of selected) ids.push(opt.value);
    }
  }

  return Array.from(new Set(ids));
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      req.log.info("[INTERACTIVE] HIT");

      const payload = parseSlackPayload(req.body);
      if (!payload) {
        req.log.warn({ body: req.body }, "[INTERACTIVE] payload missing/invalid");
        return reply.status(200).send();
      }

      const userId = payload.user?.id as string | undefined;

      // =========================
      // BLOCK ACTIONS
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // Botões da Home (topo)
        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          await slack.views.open({ trigger_id: payload.trigger_id, view: createTaskModalView() });
          return reply.status(200).send();
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          await slack.views.open({ trigger_id: payload.trigger_id, view: sendBatchModalView() });
          return reply.status(200).send();
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          await slack.views.open({ trigger_id: payload.trigger_id, view: createProjectModalView() });
          return reply.status(200).send();
        }

        // Botão: concluir selecionadas
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          const selectedIds = getSelectedTaskIdsFromHome(payload);
          req.log.info({ selectedIds }, "[INTERACTIVE] conclude selected");

          if (!userId) return reply.status(200).send();

          if (selectedIds.length) {
            // Deleta todas as selecionadas
            await prisma.task.deleteMany({
              where: { id: { in: selectedIds }, responsible: userId },
            });
          }

          // Atualiza a home do usuário
          await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // Botão: refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // Checkbox click sozinho: não faz nada (só seleciona)
        if (actionId === TASK_SELECT_ACTION_ID) {
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================
      // VIEW SUBMISSION
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // ---- Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();

          // ✅ descriptionRaw separado (pra não quebrar quando vazio)
          const descriptionRaw = getInputValue(values, "desc_block", "description");
          const description = descriptionRaw?.trim() ? descriptionRaw.trim() : undefined;

          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!userId) return reply.send({});
          if (!title || !responsible) return reply.send({});

          const createdBy = userId;

          req.log.info(
            { title, responsible, dueDate, urgency, carbonCopiesCount: carbonCopies.length, hasDesc: !!description },
            "[INTERACTIVE] create_task parsed"
          );

          // 1) cria no banco
          const task = await createTaskService({
            title,
            description,            // opcional
            delegation: createdBy,
            responsible,
            term: dueDate ?? null,  // string -> será convertida no service
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          req.log.info({ taskId: task.id }, "[INTERACTIVE] task created");

          // 2) notifica
          try {
            await notifyTaskCreated({
              slack,
              taskId: task.id,
              createdBy,
              taskTitle: title,
              responsible,
              carbonCopies,
              description,
              term: dueDate ?? null,
              urgency: urgency as any, // ou tipa corretamente se você já tem Urgency
            });

            req.log.info({ taskId: task.id }, "[INTERACTIVE] notify ok");
          } catch (e) {
            req.log.error({ e, taskId: task.id }, "[INTERACTIVE] notify failed");
          }

          // 3) atualiza homes
          await publishHome(slack, createdBy);
          if (responsible && responsible !== createdBy) {
            await publishHome(slack, responsible);
          }

          return reply.send({}); // fecha modal
        }

        // ---- Lote (placeholder)
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // ---- Projeto (placeholder)
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      return reply.status(200).send(); // Slack precisa 200
    }
  });
}
