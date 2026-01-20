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
  TASKS_SEND_QUESTION_ACTION_ID,
  TASKS_RESCHEDULE_ACTION_ID,
  TASKS_VIEW_DETAILS_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,
} from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { prisma } from "../lib/prisma";

import {
  notifyTaskCreated,
  TASK_DETAILS_CONCLUDE_ACTION_ID,
  TASK_DETAILS_QUESTION_ACTION_ID,
} from "../services/notifyTaskCreated";

type SlackPayload = any;

// ===== Seleção de tasks por usuário (memória) =====
// (se reiniciar o servidor, zera — ok pro MVP)
const selectedByUser = new Map<string, Set<string>>();

function setSelected(userId: string, taskIds: string[]) {
  selectedByUser.set(userId, new Set(taskIds));
}
function getSelected(userId: string) {
  return Array.from(selectedByUser.get(userId) ?? new Set<string>());
}
function clearSelected(userId: string) {
  selectedByUser.delete(userId);
}

// Helpers (modal)
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
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload: SlackPayload =
        typeof body?.payload === "string" ? JSON.parse(body.payload) : body?.payload;

      if (!payload) return reply.status(200).send();

      const userId = payload.user?.id as string | undefined;

      // =========================
      // BLOCK ACTIONS (botões / checkbox)
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        // ---- Botões do header (Home)
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

        // ---- Checkbox (selecionar tasks)
        // action.selected_options = [{ value: taskId }, ...]
        if (actionId === TASK_SELECT_ACTION_ID) {
          const selectedOptions = (action?.selected_options ?? []) as Array<{ value: string }>;
          const ids = selectedOptions.map((o) => o.value).filter(Boolean);
          if (userId) setSelected(userId, ids);

          // só ACK; a Home não precisa repintar só por selecionar
          return reply.status(200).send();
        }

        // ---- Botão: Concluir selecionadas (DELETA)
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const ids = getSelected(userId);
          req.log.info({ userId, idsCount: ids.length }, "[TASKS] conclude selected");

          if (ids.length) {
            await prisma.task.deleteMany({ where: { id: { in: ids } } });
            clearSelected(userId);
          }

          await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // ---- Botões extras (por enquanto só placeholder + refresh home)
        if (
          actionId === TASKS_SEND_QUESTION_ACTION_ID ||
          actionId === TASKS_RESCHEDULE_ACTION_ID ||
          actionId === TASKS_VIEW_DETAILS_ACTION_ID ||
          actionId === TASKS_REFRESH_ACTION_ID
        ) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // ---- Botões da NOTIFICAÇÃO DM (taskId vem no value)
        if (actionId === TASK_DETAILS_CONCLUDE_ACTION_ID) {
          const taskId = action?.value as string | undefined;
          if (taskId) {
            await prisma.task.delete({ where: { id: taskId } }).catch(() => null);
          }
          // atualiza home do usuário que clicou (responsável)
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        if (actionId === TASK_DETAILS_QUESTION_ACTION_ID) {
          // placeholder: depois você pode abrir modal "dúvida"
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================
      // VIEW SUBMISSION (submit modal)
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;

        // ---- Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = getInputValue(values, "title_block", "title") ?? "";
          const description = getInputValue(values, "desc_block", "description"); // opcional
          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = (getSelectedOptionValue(values, "urgency_block", "urgency") ??
            "light") as "light" | "asap" | "turbo";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          // quem delegou = quem submeteu
          const createdBy = userId ?? "";

          // cria no banco (IMPORTANTE: createTaskService deve retornar a task)
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

          // notifica (responsável com blocks, CC com texto)
          await notifyTaskCreated({
            slack,
            createdBy,
            responsible,
            carbonCopies,
            taskId: task.id,
            taskTitle: task.title,
            description: task.description,
            term: task.term,
            urgency: task.urgency,
          });

          // atualiza Home do criador e do responsável (se diferente)
          if (createdBy) await publishHome(slack, createdBy);
          if (responsible && responsible !== createdBy) await publishHome(slack, responsible);

          // fecha modal
          return reply.send({});
        }

        // ---- Lote
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // ---- Projeto
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      // Slack precisa de 200 sempre
      return reply.status(200).send();
    }
  });
}
