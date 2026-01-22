// src/routes/interactive.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import formbody from "@fastify/formbody";
import { TASK_DETAILS_CONCLUDE_ACTION_ID } from "../services/notifyTaskCreated";

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
import { notifyTaskCreated } from "../services/notifyTaskCreated";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";

// ✅ NOVO: action_ids da Home (rodapé + checkbox)
import {
  TASK_SELECT_ACTION_ID,
  TASKS_CONCLUDE_SELECTED_ACTION_ID,
  TASKS_SEND_QUESTION_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,
} from "../views/homeTasksBlocks";

// ✅ NOVO: abre thread (MPIM) com todos envolvidos
import { openQuestionThread } from "../services/openQuestionThread";

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

// ✅ NOVO: pega TODAS taskIds selecionadas na Home via view.state.values
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

function isUuid(v: unknown) {
  return typeof v === "string" && /^[0-9a-fA-F-]{36}$/.test(v);
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    // Slack precisa sempre 200 rápido
    try {
      req.log.info("[INTERACTIVE] HIT");

      const payload = parseSlackPayload(req.body);
      if (!payload) {
        req.log.warn({ body: req.body }, "[INTERACTIVE] invalid payload");
        return reply.status(200).send();
      }

      const userId = payload.user?.id as string | undefined;

      // =========================================================
      // 0) BLOCK SUGGESTION (external_select: projetos)
      // =========================================================
      if (payload.type === "block_suggestion") {
        const query = (payload.value ?? "").toString().trim();

        const actionId =
          payload.action_id ??
          payload.action?.action_id ??
          payload.actions?.[0]?.action_id;

        if (actionId !== TASK_PROJECT_ACTION_ID) {
          return reply.status(200).send({ options: [] });
        }

        const projects = await prisma.project.findMany({
          where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, name: true },
        });

        return reply.status(200).send({
          options: projects.map((p) => ({
            text: { type: "plain_text", text: p.name },
            value: p.id,
          })),
        });
      }

      // =========================================================
      // 1) BLOCK ACTIONS (botões)
      // =========================================================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // ======= (mantém) Botões da Home (topo)
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

        // ======= ✅ NOVO: Checkbox sozinho (só seleciona, não faz nada)
        if (actionId === TASK_SELECT_ACTION_ID) {
          return reply.status(200).send();
        }

        // ======= ✅ NOVO: Refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // ======= ✅ NOVO: Concluir selecionadas (muda status => done)
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const selectedIds = getSelectedTaskIdsFromHome(payload);
          req.log.info({ selectedIds }, "[INTERACTIVE] conclude selected");

          if (selectedIds.length) {
            await prisma.task.updateMany({
              where: {
                id: { in: selectedIds },
                responsible: userId,
                status: "pending",
              },
              data: { status: "done" },
            });
          }

          await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // ======= ✅ NOVO: Concluir na mensagem (action_id vindo do notify)
        if (actionId === TASK_DETAILS_CONCLUDE_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const taskId = action?.value as string | undefined;
          if (taskId && isUuid(taskId)) {
            await prisma.task.updateMany({
              where: {
                id: taskId,
                responsible: userId,
                status: "pending",
              },
              data: { status: "done" },
            });
            await publishHome(slack, userId);
          }

          return reply.status(200).send();
        }

        // ======= ✅ NOVO: Enviar dúvida
        // - Se vier da mensagem: action.value = taskId
        // - Se vier da Home: usa selecionadas
        if (actionId === TASKS_SEND_QUESTION_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const value = action?.value as string | undefined;

          const taskIds = value && isUuid(value)
            ? [value]
            : getSelectedTaskIdsFromHome(payload);

          req.log.info({ taskIds, fromValue: value }, "[INTERACTIVE] send_question");

          if (!taskIds.length) return reply.status(200).send();

          for (const taskId of taskIds) {
            try {
              await openQuestionThread({
                slack,
                taskId,
                requestedBy: userId,
              });
            } catch (e) {
              req.log.error({ e, taskId }, "[INTERACTIVE] openQuestionThread failed");
            }
          }

          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================================================
      // 2) VIEW SUBMISSION (submit do modal)
      // =========================================================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // -------------------------
        // CREATE TASK
        // -------------------------
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();

          const descriptionRaw = getInputValue(values, "desc_block", "description");
          const description = descriptionRaw?.trim() ? descriptionRaw.trim() : undefined;

          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";

          const dueDate = getSelectedDate(values, "due_block", "due_date"); // YYYY-MM-DD
          const deadlineTime = getSelectedTime(values, TASK_TIME_BLOCK_ID, TASK_TIME_ACTION_ID); // HH:MM

          const recurrence = getSelectedOptionValue(values, TASK_RECURRENCE_BLOCK_ID, TASK_RECURRENCE_ACTION_ID); // daily..annual
          const projectId = getSelectedOptionValue(values, TASK_PROJECT_BLOCK_ID, TASK_PROJECT_ACTION_ID); // uuid

          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!userId) return reply.send({});
          if (!title || !responsible) return reply.send({});

          req.log.info(
            {
              title,
              responsible,
              dueDate,
              deadlineTime,
              recurrence,
              projectId,
              urgency,
              carbonCopiesCount: carbonCopies.length,
              hasDesc: !!description,
            },
            "[INTERACTIVE] create_task parsed"
          );

          // 1) cria no banco
          const task = await createTaskService({
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

          req.log.info({ taskId: task.id }, "[INTERACTIVE] task created");

          // 2) notifica (responsável + CC)
          try {
            await notifyTaskCreated({
              slack,
              taskId: task.id,
              createdBy: userId,
              taskTitle: title,
              responsible,
              carbonCopies,
            });
            req.log.info({ taskId: task.id }, "[INTERACTIVE] notify ok");
          } catch (e) {
            req.log.error({ e, taskId: task.id }, "[INTERACTIVE] notify failed");
          }

          // 3) atualiza Home (criador e responsável)
          try {
            await publishHome(slack, userId);
            if (responsible && responsible !== userId) {
              await publishHome(slack, responsible);
            }
            req.log.info({ userId, responsible }, "[INTERACTIVE] publishHome ok");
          } catch (e) {
            req.log.error({ e }, "[INTERACTIVE] publishHome failed");
          }

          return reply.send({}); // fecha modal
        }

        // -------------------------
        // PLACEHOLDERS
        // -------------------------
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) return reply.send({});
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) return reply.send({});

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      return reply.status(200).send();
    }
  });
}
