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

import { TASK_SELECT_ACTION_ID, TASKS_CONCLUDE_SELECTED_ACTION_ID } from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { publishHome } from "../services/publishHome";
import { notifyTaskCreated } from "../services/notifyTaskCreated";
import { prisma } from "../lib/prisma";

type SlackPayload = any;

// Helpers (modal view_submission)
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

// Helper: pega IDs selecionados nos checkboxes na Home
function collectSelectedTaskIdsFromViewState(viewStateValues: any): string[] {
  const stateValues = viewStateValues ?? {};
  const ids: string[] = [];

  for (const block of Object.values(stateValues)) {
    const actionState: any = (block as any)?.[TASK_SELECT_ACTION_ID];
    const selected = (actionState?.selected_options ?? []) as Array<{ value: string }>;
    for (const opt of selected) {
      if (opt?.value) ids.push(opt.value);
    }
  }

  // remove duplicados
  return Array.from(new Set(ids));
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  // Slack manda x-www-form-urlencoded com payload=...
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      req.log.info({ at: new Date().toISOString() }, "[INTERACTIVE] HIT");

      const body = req.body as any;
      const payload: SlackPayload =
        typeof body?.payload === "string" ? JSON.parse(body.payload) : body?.payload;

      if (!payload) {
        req.log.warn({ body }, "[INTERACTIVE] missing payload");
        return reply.status(200).send();
      }

      // ======================================================
      // 1) BLOCK ACTIONS (botões, checkboxes)
      // ======================================================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;
        const userId = payload.user?.id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // --- Botões do header da Home
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

        // --- Botão ✅ Concluir selecionadas (age nas tasks marcadas)
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID) {
          const selectedTaskIds = collectSelectedTaskIdsFromViewState(payload.view?.state?.values);

          req.log.info(
            { userId, selectedTaskIdsCount: selectedTaskIds.length, selectedTaskIds },
            "[INTERACTIVE] conclude selected"
          );

          if (userId && selectedTaskIds.length) {
            await prisma.task.deleteMany({
              where: {
                id: { in: selectedTaskIds },
                responsible: userId, // proteção: só conclui as suas
              },
            });
          }

          if (userId) await publishHome(slack, userId);

          return reply.status(200).send();
        }

        // (Opcional) Se quiser logar seleção individual sem fazer nada:
        if (actionId === TASK_SELECT_ACTION_ID) {
          // Não faz nada aqui — a ação real acontece no botão "Concluir selecionadas"
          return reply.status(200).send();
        }

        return reply.status(200).send(); // ACK padrão
      }

      // ======================================================
      // 2) VIEW SUBMISSION (submit de modais)
      // ======================================================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;
        const userId = payload.user?.id as string | undefined;

        req.log.info({ cb, userId }, "[INTERACTIVE] view_submission");

        // ---- Criar tarefa
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = (getInputValue(values, "title_block", "title") ?? "").trim();
          const description = getInputValue(values, "desc_block", "description")?.trim();
          const responsible = getSelectedUser(values, "resp_block", "responsible") ?? "";
          const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          req.log.info(
            {
              title,
              responsible,
              dueDate,
              urgency,
              carbonCopiesCount: carbonCopies.length,
              hasDescription: Boolean(description),
            },
            "[INTERACTIVE] create_task parsed"
          );

          // Quem criou (delegou)
          const createdBy = userId ?? "";

          const task = await createTaskService({
            title,
            description: description ? description : undefined, // ✅ opcional
            delegation: createdBy,
            responsible,
            term: dueDate ?? null,
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          // Notifica responsável + CC
          await notifyTaskCreated({
            slack,
            createdBy,
            taskTitle: task.title,
            responsible,
            carbonCopies,
          });

          // Atualiza Home do criador
          if (userId) await publishHome(slack, userId);

          // Atualiza Home do responsável (se for diferente)
          if (responsible && responsible !== userId) {
            await publishHome(slack, responsible);
          }

          // Fecha modal
          return reply.send({});
        }

        // ---- Modal lote (placeholder)
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // ---- Modal projeto (placeholder)
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.send({});
        }

        // default: fecha modal
        return reply.send({});
      }

      // default ACK
      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      // Slack precisa de 200 sempre, senão ele re-tenta
      return reply.status(200).send();
    }
  });
}
