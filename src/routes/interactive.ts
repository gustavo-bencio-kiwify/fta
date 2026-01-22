// src/routes/interactive.ts (ou src/slack/routes/interactive.ts)
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
} from "../views/createTaskModal";
import {
  sendBatchModalView,
  SEND_BATCH_MODAL_CALLBACK_ID,
} from "../views/sendBatchModal";
import {
  createProjectModalView,
  CREATE_PROJECT_MODAL_CALLBACK_ID,
} from "../views/createProjectModal";

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

// action_ids dos botões do DM (notificação)
const TASK_DETAILS_CONCLUDE_ACTION_ID = "task_details_conclude" as const;
const TASK_DETAILS_QUESTION_ACTION_ID = "task_details_question" as const;

// caso você ainda esteja usando isso em algum lugar (pra não quebrar)
const LEGACY_TASK_TOGGLE_DONE_ACTION_ID = "task_toggle_done" as const;

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

// executa algo depois do ACK sem travar a resposta do Slack
function runAsync(fn: () => Promise<void>, log: (obj: any, msg?: string) => void) {
  setImmediate(() => {
    fn().catch((err) => log({ err }, "[INTERACTIVE] async error"));
  });
}

// Pega TODOS taskIds selecionados na Home (checkbox accessory)
// Suporta action_id novo (TASK_SELECT_ACTION_ID) e o legado ("task_toggle_done")
function getSelectedTaskIdsFromHome(payload: any): string[] {
  const stateValues = payload?.view?.state?.values;
  if (!stateValues) return [];

  const ids: string[] = [];

  for (const block of Object.values(stateValues)) {
    const b = block as any;

    const actionNew = b?.[TASK_SELECT_ACTION_ID];
    const selectedNew = actionNew?.selected_options as Array<{ value: string }> | undefined;
    if (selectedNew?.length) {
      for (const opt of selectedNew) ids.push(opt.value);
    }

    const actionLegacy = b?.[LEGACY_TASK_TOGGLE_DONE_ACTION_ID];
    const selectedLegacy = actionLegacy?.selected_options as Array<{ value: string }> | undefined;
    if (selectedLegacy?.length) {
      for (const opt of selectedLegacy) ids.push(opt.value);
    }
  }

  return Array.from(new Set(ids));
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  // Slack manda x-www-form-urlencoded com payload=...
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    req.log.info("[INTERACTIVE] HIT");

    const payload = parseSlackPayload(req.body);
    if (!payload) {
      req.log.warn({ body: req.body }, "[INTERACTIVE] payload missing/invalid");
      return reply.status(200).send();
    }

    const userId = payload.user?.id as string | undefined;

    try {
      // =========================
      // BLOCK ACTIONS (botões, checkboxes, botões do DM)
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // ✅ ACK rápido
        reply.status(200).send();

        // ---- Botões do topo da Home
        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          runAsync(async () => {
            await slack.views.open({
              trigger_id: payload.trigger_id,
              view: createTaskModalView(),
            });
          }, req.log.error.bind(req.log));
          return;
        }

        if (actionId === HOME_SEND_BATCH_ACTION_ID) {
          runAsync(async () => {
            await slack.views.open({
              trigger_id: payload.trigger_id,
              view: sendBatchModalView(),
            });
          }, req.log.error.bind(req.log));
          return;
        }

        if (actionId === HOME_NEW_PROJECT_ACTION_ID) {
          runAsync(async () => {
            await slack.views.open({
              trigger_id: payload.trigger_id,
              view: createProjectModalView(),
            });
          }, req.log.error.bind(req.log));
          return;
        }

        // ---- Checkbox (apenas seleciona; não faz nada ao clicar)
        if (actionId === TASK_SELECT_ACTION_ID || actionId === LEGACY_TASK_TOGGLE_DONE_ACTION_ID) {
          return;
        }

        // ---- Botão: Concluir selecionadas (deleta)
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          const selectedIds = getSelectedTaskIdsFromHome(payload);
          req.log.info({ selectedIds, userId }, "[INTERACTIVE] conclude selected");

          if (!userId) return;

          runAsync(async () => {
            if (selectedIds.length) {
              await prisma.task.deleteMany({
                where: { id: { in: selectedIds }, responsible: userId },
              });
            }
            await publishHome(slack, userId);
          }, req.log.error.bind(req.log));

          return;
        }

        // ---- Botão: Refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (!userId) return;

          runAsync(async () => {
            await publishHome(slack, userId);
          }, req.log.error.bind(req.log));

          return;
        }

        // ✅ Botão "Concluir" no DM (notificação)
        if (actionId === TASK_DETAILS_CONCLUDE_ACTION_ID) {
          const taskId = action?.value as string | undefined;
          req.log.info({ taskId, userId }, "[INTERACTIVE] task_details_conclude");

          if (!userId || !taskId) return;

          runAsync(async () => {
            // garante que só o responsável consegue concluir
            await prisma.task.deleteMany({
              where: { id: taskId, responsible: userId },
            });
            await publishHome(slack, userId);
          }, req.log.error.bind(req.log));

          return;
        }

        // (placeholder) Botão "Enviar dúvida" no DM
        if (actionId === TASK_DETAILS_QUESTION_ACTION_ID) {
          const taskId = action?.value as string | undefined;
          req.log.info({ taskId, userId }, "[INTERACTIVE] task_details_question");
          return;
        }

        return;
      }

      // =========================
      // VIEW SUBMISSION (submit de modal)
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // ✅ Slack precisa de {} pra fechar modal
        reply.send({});

        if (!userId) return;

        // ---- Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();

          // ✅ descriptionRaw separado (não obriga e não quebra quando vazio)
          const descriptionRaw = getInputValue(values, "desc_block", "description");
          const description = descriptionRaw?.trim() ? descriptionRaw.trim() : undefined;

          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!title || !responsible) return;

          runAsync(async () => {
            // 1) cria no banco
            const task = await createTaskService({
              title,
              description,           // opcional
              delegation: userId,    // quem criou (delegou)
              responsible,
              term: dueDate ?? null, // string YYYY-MM-DD ou null
              urgency,
              recurrence: "none",
              carbonCopies,
            });

            req.log.info({ taskId: task.id }, "[INTERACTIVE] task created");

            // 2) notifica (inclui notificar a si mesmo, conforme você pediu)
            await notifyTaskCreated({
              slack,
              taskId: task.id,
              createdBy: userId,
              taskTitle: task.title,          
              responsible: task.responsible,  
              carbonCopies,                   
              description: task.description,  
              term: task.term,                
              urgency: task.urgency,          
            });


            // 3) atualiza homes
            await publishHome(slack, userId);
            if (responsible && responsible !== userId) {
              await publishHome(slack, responsible);
            }
          }, req.log.error.bind(req.log));

          return;
        }

        // ---- Lote (placeholder)
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          runAsync(async () => {
            await publishHome(slack, userId);
          }, req.log.error.bind(req.log));
          return;
        }

        // ---- Projeto (placeholder)
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          runAsync(async () => {
            await publishHome(slack, userId);
          }, req.log.error.bind(req.log));
          return;
        }

        return;
      }

      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      // Slack precisa 200 sempre
      if (!reply.sent) return reply.status(200).send();
    }
  });
}
