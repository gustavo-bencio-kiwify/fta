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

const TASK_TOGGLE_DONE_ACTION_ID = "task_toggle_done" as const;

type SlackPayload = any;

// Helpers: extração segura do view.state.values
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

function isSlackPayload(body: any): body is { payload: string } {
  return body && typeof body.payload === "string";
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  // Slack manda x-www-form-urlencoded com payload=...
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      req.log.info(
        {
          ct: req.headers["content-type"],
          ua: req.headers["user-agent"],
        },
        "[INTERACTIVE] HIT"
      );

      const body = req.body as any;

      // Parse do payload
      const payload: SlackPayload = isSlackPayload(body)
        ? JSON.parse(body.payload)
        : typeof body?.payload === "object"
          ? body.payload
          : null;

      req.log.info(
        { type: payload?.type, callback: payload?.view?.callback_id },
        "[INTERACTIVE] parsed payload"
      );

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

        // Botões da Home
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

        // Checkbox: hoje está deletando ao selecionar (você pediu "excluir done" e vinha deletando)
        if (actionId === TASK_TOGGLE_DONE_ACTION_ID) {
          // Se você usa checkbox com options[].value = taskId
          const selected = action?.selected_options as Array<{ value: string }> | undefined;
          const taskId = selected?.[0]?.value;

          req.log.info({ taskId, userId }, "[INTERACTIVE] checkbox toggle");

          if (taskId) {
            await prisma.task.delete({ where: { id: taskId } });
            if (userId) await publishHome(slack, userId);
          }

          return reply.status(200).send();
        }

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
          try {
            const values = payload.view.state.values;

            const title = (getInputValue(values, "title_block", "title") ?? "").trim();
            const descriptionRaw = getInputValue(values, "desc_block", "description");
            const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : undefined;

            const responsible = (getSelectedUser(values, "resp_block", "responsible") ?? "").trim();
            const dueDate = getSelectedDate(values, "due_block", "due_date"); // "YYYY-MM-DD" | undefined
            const urgency = (getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light").trim();
            const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

            req.log.info(
              {
                title,
                hasDescription: !!description,
                responsible,
                dueDate,
                urgency,
                carbonCopiesCount: carbonCopies.length,
              },
              "[INTERACTIVE] create_task parsed"
            );

            // validações mínimas pra UX no modal (antes de cair no Zod/Prisma)
            const errors: Record<string, string> = {};
            if (!title) errors["title_block"] = "Informe um título.";
            if (!responsible) errors["resp_block"] = "Selecione um responsável.";

            if (Object.keys(errors).length) {
              return reply.send({ response_action: "errors", errors });
            }

            const createdBy = payload.user?.id as string;

            const createdTask = await createTaskService({
              title,
              description: description?.length ? description : undefined, // opcional
              delegation: createdBy,
              responsible,
              term: dueDate ?? null,
              urgency,
              recurrence: "none",
              carbonCopies,
            });

            req.log.info({ taskId: createdTask.id }, "[INTERACTIVE] task created");

            // Notifica responsável + CC (seu service)
            await notifyTaskCreated({
              slack,
              createdBy,
              taskTitle: title,
              responsible,
              carbonCopies,
            });

            // Atualiza Home do criador e do responsável
            if (userId) await publishHome(slack, userId);
            if (responsible && responsible !== userId) await publishHome(slack, responsible);

            return reply.send({}); // fecha modal
          } catch (err: any) {
            req.log.error({ err }, "[INTERACTIVE] create_task failed");

            // Mostra erro dentro do modal (Slack)
            return reply.send({
              response_action: "errors",
              errors: {
                // você pode trocar o bloco que recebe erro (title_block/desc_block/etc)
                title_block: "Não consegui salvar a tarefa. Veja os logs no Render.",
              },
            });
          }
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
      // Slack precisa de 200 sempre
      return reply.status(200).send();
    }
  });
}
