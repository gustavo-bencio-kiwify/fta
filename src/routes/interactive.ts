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

import {
  createProjectModalView,
  CREATE_PROJECT_MODAL_CALLBACK_ID,
  PROJECT_NAME_BLOCK_ID,
  PROJECT_NAME_ACTION_ID,
  PROJECT_DESC_BLOCK_ID,
  PROJECT_DESC_ACTION_ID,
  PROJECT_END_BLOCK_ID,
  PROJECT_END_ACTION_ID,
  PROJECT_MEMBERS_BLOCK_ID,
  PROJECT_MEMBERS_ACTION_ID,
} from "../views/createProjectModal";

import {
  TASK_SELECT_ACTION_ID,
  TASKS_CONCLUDE_SELECTED_ACTION_ID,
  TASKS_SEND_QUESTION_ACTION_ID,
  TASKS_RESCHEDULE_ACTION_ID,
  TASKS_VIEW_DETAILS_ACTION_ID,
  TASKS_REFRESH_ACTION_ID,

  // placeholders
  DELEGATED_SEND_FUP_ACTION_ID,
  DELEGATED_EDIT_ACTION_ID,
  DELEGATED_CANCEL_ACTION_ID,
  CC_SEND_QUESTION_ACTION_ID,
  RECURRENCE_CANCEL_ACTION_ID,
  PROJECT_VIEW_ACTION_ID,
  PROJECT_CREATE_TASK_ACTION_ID,
  PROJECT_EDIT_ACTION_ID,
  PROJECT_CONCLUDE_ACTION_ID,
} from "../views/homeTasksBlocks";

import {
  rescheduleTaskModalView,
  RESCHEDULE_TASK_MODAL_CALLBACK_ID,
  RESCHEDULE_TERM_BLOCK_ID,
  RESCHEDULE_TERM_ACTION_ID,
  RESCHEDULE_TIME_BLOCK_ID,
  RESCHEDULE_TIME_ACTION_ID,
} from "../views/rescheduleTaskModal";

// ✅ EDIT MODAL (simples)
import {
  editTaskModalView,
  EDIT_TASK_MODAL_CALLBACK_ID,
  EDIT_TITLE_BLOCK_ID,
  EDIT_TITLE_ACTION_ID,
  EDIT_DESC_BLOCK_ID,
  EDIT_DESC_ACTION_ID,
  EDIT_TERM_BLOCK_ID,
  EDIT_TERM_ACTION_ID,
  EDIT_TIME_BLOCK_ID,
  EDIT_TIME_ACTION_ID,
} from "../views/editTaskModal";

import { prisma } from "../lib/prisma";
import { createTaskService } from "../services/createTaskService";
import { updateTaskService } from "../services/updateTaskService";

import { notifyTaskCreated, TASK_DETAILS_CONCLUDE_ACTION_ID } from "../services/notifyTaskCreated";
import { notifyTaskCompleted } from "../services/notifyTaskCompleted";
import { publishHome } from "../services/publishHome";
import { openQuestionThread } from "../services/openQuestionThread";
import { createProjectService } from "../services/createProjectService";
import { rescheduleTaskService } from "../services/rescheduleTaskService";
import { notifyTaskRescheduledGroup } from "../services/notifyTaskRescheduledGroup";
import { notifyTaskCanceledGroup } from "../services/notifyTaskCanceledGroup";
import { notifyTaskEdited } from "../services/notifyTaskEdited";
import { taskDetailsModalView } from "../views/taskDetailsModal";
import { createNextRecurringTaskFromCompleted } from "../services/createNextRecurringTaskFromCompleted";


type SlackPayload = any;

/**
 * ✅ Aceita:
 * 1) body.payload = JSON string (formbody)
 * 2) body.payload = object
 * 3) body já é o payload (application/json)
 */
function parseSlackPayload(body: any): SlackPayload | null {
  if (!body) return null;

  if (typeof body === "object" && body.type) return body;

  const maybePayload = body.payload;

  if (typeof maybePayload === "string") {
    try {
      return JSON.parse(maybePayload);
    } catch {
      return null;
    }
  }

  if (maybePayload && typeof maybePayload === "object") return maybePayload;

  return null;
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

function getSelectedTaskIdsFromHome(payload: any): string[] {
  const stateValues = payload?.view?.state?.values;
  if (!stateValues) return [];

  const ids: string[] = [];
  for (const block of Object.values(stateValues)) {
    const action = (block as any)?.[TASK_SELECT_ACTION_ID];
    const selected = action?.selected_options as Array<{ value: string }> | undefined;
    if (selected?.length) for (const opt of selected) ids.push(opt.value);
  }
  return Array.from(new Set(ids));
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function formatDateBRFromIso(iso: string) {
  // ✅ interpreta como 00:00 SP
  const d = new Date(`${iso}T03:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;

  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
}


async function sendBotDm(slack: WebClient, userId: string, text: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) return;
  await slack.chat.postMessage({ channel: channelId, text });
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      req.log.info("[INTERACTIVE] HIT");

      const payload = parseSlackPayload(req.body);
      if (!payload) {
        req.log.warn({ body: req.body }, "[INTERACTIVE] invalid payload");
        return reply.status(200).send();
      }

      const userId = payload.user?.id as string | undefined;

      // =========================================================
      // 0) BLOCK SUGGESTION (external_select: projetos no modal de task)
      // =========================================================
      if (payload.type === "block_suggestion") {
        const query = (payload.value ?? "").toString().trim();

        const actionId =
          payload.action_id ?? payload.action?.action_id ?? payload.actions?.[0]?.action_id;

        if (actionId !== TASK_PROJECT_ACTION_ID) {
          return reply.status(200).send({ options: [] });
        }
        if (!userId) {
          return reply.status(200).send({ options: [] });
        }

        const projects = await prisma.project.findMany({
          where: {
            status: "active",
            members: { some: { slackUserId: userId } },
            ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
          },
          orderBy: { name: "asc" },
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
      // 1) BLOCK ACTIONS
      // =========================================================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        req.log.info({ actionId, userId }, "[INTERACTIVE] block_actions");

        // ---- Topo (Home Header)
        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          const projects =
            userId
              ? await prisma.project.findMany({
                where: { status: "active", members: { some: { slackUserId: userId } } },
                orderBy: { name: "asc" },
                take: 100,
                select: { id: true, name: true },
              })
              : [];

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: createTaskModalView({ projects }),
          });

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

        // ============================
        // ✅ CONCLUIR (Home) + Concluir (DM da task)
        // ============================
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID || actionId === TASK_DETAILS_CONCLUDE_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const selectedIds =
            actionId === TASK_DETAILS_CONCLUDE_ACTION_ID
              ? [String(action?.value ?? "")]
              : getSelectedTaskIdsFromHome(payload);

          req.log.info({ selectedIds }, "[INTERACTIVE] conclude selected");

          if (!selectedIds.length) {
            await publishHome(slack, userId);
            return reply.status(200).send();
          }

          const tasksToConclude = await prisma.task.findMany({
            where: {
              id: { in: selectedIds },
              responsible: userId,
              status: { not: "done" },
            },
            select: {
              id: true,
              title: true,
              responsible: true,
              delegation: true,
              carbonCopies: { select: { slackUserId: true } },
            },
          });

          if (!tasksToConclude.length) {
            await publishHome(slack, userId);
            return reply.status(200).send();
          }

          await prisma.task.updateMany({
            where: { id: { in: tasksToConclude.map((t) => t.id) }, responsible: userId },
            data: { status: "done" },
          });

          // ✅ NOVO: gera próxima instância (se a task for recorrente)
          // (se não for recorrente, o service retorna null e não faz nada)
          await Promise.allSettled(
            tasksToConclude.map((t) =>
              createNextRecurringTaskFromCompleted({ completedTaskId: t.id })
            )
          );

          await Promise.allSettled(
            tasksToConclude.map((t) =>
              notifyTaskCompleted({
                slack,
                taskTitle: t.title,
                responsible: t.responsible,
                delegation: t.delegation ?? "",
                carbonCopies: t.carbonCopies.map((c) => c.slackUserId),
              })
            )
          );

          await Promise.allSettled([
            publishHome(slack, userId),
            ...Array.from(new Set(tasksToConclude.map((t) => t.delegation).filter(Boolean) as string[])).map(
              (id) => publishHome(slack, id)
            ),
          ]);

          return reply.status(200).send();
        }


        // ---- Refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userId) await publishHome(slack, userId);
          return reply.status(200).send();
        }

        // ---- Enviar dúvida
        if (actionId === TASKS_SEND_QUESTION_ACTION_ID || actionId === CC_SEND_QUESTION_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const value = (action?.value ?? "").toString();
          const valueIsTaskId = isUuid(value);
          const taskIds = valueIsTaskId ? [value] : getSelectedTaskIdsFromHome(payload);

          if (!taskIds.length) return reply.status(200).send();

          await Promise.all(
            taskIds.map(async (taskId) => {
              try {
                await openQuestionThread({ slack, taskId, requestedBy: userId });
              } catch (e) {
                req.log.error({ e, taskId }, "[INTERACTIVE] openQuestionThread failed");
              }
            })
          );

          return reply.status(200).send();
        }

        // ---- Concluir Projeto
        if (actionId === PROJECT_CONCLUDE_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const projectId = String(action?.value ?? "").trim();
          if (!projectId) return reply.status(200).send();

          const project = await prisma.project.findFirst({
            where: {
              id: projectId,
              status: "active",
              members: { some: { slackUserId: userId } },
            },
            select: {
              id: true,
              name: true,
              members: { select: { slackUserId: true } },
            },
          });

          if (!project) {
            await publishHome(slack, userId);
            return reply.status(200).send();
          }

          await prisma.project.update({
            where: { id: project.id },
            data: { status: "concluded", concludedAt: new Date() },
          });

          await Promise.allSettled([
            sendBotDm(slack, userId, `✅ Projeto *${project.name}* foi concluído e arquivado.`),
          ]);

          await Promise.allSettled([
            publishHome(slack, userId),
            ...Array.from(new Set(project.members.map((m) => m.slackUserId))).map((uid) => publishHome(slack, uid)),
          ]);

          return reply.status(200).send();
        }

        // ---- Reprogramar Prazo (abre modal)
        if (actionId === TASKS_RESCHEDULE_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const selectedIds = getSelectedTaskIdsFromHome(payload);
          if (!selectedIds.length) {
            await publishHome(slack, userId);
            return reply.status(200).send();
          }

          const taskId = selectedIds[0];

          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              status: { not: "done" },
              OR: [{ responsible: userId }, { delegation: userId }],
            },
            select: { id: true, title: true, term: true, deadlineTime: true },
          });

          if (!task) {
            await publishHome(slack, userId);
            return reply.status(200).send();
          }

          const currentDateIso = task.term ? task.term.toISOString().slice(0, 10) : null;

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: rescheduleTaskModalView({
              taskId: task.id,
              taskTitle: task.title,
              currentDateIso,
              currentTime: task.deadlineTime ?? null,
            }),
          });

          return reply.status(200).send();
        }

        // ---- Cancelar tarefa delegada (DELETE)
        if (actionId === DELEGATED_CANCEL_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          // ✅ ACK IMEDIATO
          reply.status(200).send();

          void (async () => {
            const selectedIds = getSelectedTaskIdsFromHome(payload);
            req.log.info({ selectedIds }, "[INTERACTIVE] delegated_cancel selected");

            if (!selectedIds.length) {
              await publishHome(slack, userId);
              return;
            }

            const tasksToDelete = await prisma.task.findMany({
              where: {
                id: { in: selectedIds },
                delegation: userId,
                status: { not: "done" }, // opcional
              },
              select: {
                id: true,
                title: true,
                responsible: true,
                delegation: true,
                carbonCopies: { select: { slackUserId: true } },
              },
            });

            req.log.info({ count: tasksToDelete.length }, "[INTERACTIVE] delegated_cancel tasksToDelete");

            if (!tasksToDelete.length) {
              await publishHome(slack, userId);
              return;
            }

            await Promise.allSettled(
              tasksToDelete.map((t) =>
                notifyTaskCanceledGroup({
                  slack,
                  canceledBySlackId: userId,
                  responsibleSlackId: t.responsible,
                  carbonCopiesSlackIds: t.carbonCopies.map((c) => c.slackUserId),
                  taskTitle: t.title,
                })
              )
            );

            await prisma.task.deleteMany({
              where: {
                id: { in: tasksToDelete.map((t) => t.id) },
                delegation: userId,
              },
            });

            const affectedUsers = new Set<string>();
            affectedUsers.add(userId);
            for (const t of tasksToDelete) {
              affectedUsers.add(t.responsible);
              for (const c of t.carbonCopies) affectedUsers.add(c.slackUserId);
            }

            await Promise.allSettled(Array.from(affectedUsers).map((uid) => publishHome(slack, uid)));
          })().catch((err) => {
            req.log.error({ err }, "[INTERACTIVE] delegated_cancel failed");
          });

          return;
        }

        // ---- Editar tarefa (abre modal)
        if (actionId === DELEGATED_EDIT_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          const selectedIds = getSelectedTaskIdsFromHome(payload);
          if (!selectedIds.length) return reply.status(200).send();

          const taskId = selectedIds[0];

          // ✅ só quem delegou (se quiser permitir responsável, ajusta aqui e no service)
          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              status: { not: "done" },
              delegation: userId,
            },
            select: {
              id: true,
              title: true,
              description: true,
              term: true,
              deadlineTime: true,
            },
          });

          if (!task) return reply.status(200).send();

          const currentDateIso = task.term ? task.term.toISOString().slice(0, 10) : null;

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: editTaskModalView({
              taskId: task.id,
              title: task.title,
              description: task.description ?? null,
              currentDateIso,
              currentTime: task.deadlineTime ?? null,
            }),
          });

          return reply.status(200).send();
        }

        // ---- Ver detalhes (abre modal)
        if (actionId === TASKS_VIEW_DETAILS_ACTION_ID) {
          if (!userId) return reply.status(200).send();

          // suporta 2 modos:
          // 1) botão carrega um UUID no value (se você usar em outro lugar)
          // 2) botão global usa seleção via checkbox (Home)
          const value = (action?.value ?? "").toString();
          const valueIsTaskId = isUuid(value);
          const selectedIds = valueIsTaskId ? [value] : getSelectedTaskIdsFromHome(payload);

          if (selectedIds.length !== 1) {
            await sendBotDm(slack, userId, "🔎 Selecione *1* tarefa para ver os detalhes.");
            return reply.status(200).send();
          }

          const taskId = selectedIds[0];

          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              OR: [
                { responsible: userId },
                { delegation: userId },
                { carbonCopies: { some: { slackUserId: userId } } },
              ],
            },
            select: {
              id: true,
              title: true,
              description: true,
              term: true,
              deadlineTime: true,
              urgency: true,
              recurrence: true,
              projectId: true,
              responsible: true,
              delegation: true,
            },
          });

          if (!task) {
            await sendBotDm(slack, userId, "Não encontrei essa tarefa (ou você não tem permissão para ver).");
            return reply.status(200).send();
          }

          const dueDateIso = task.term ? task.term.toISOString().slice(0, 10) : null;

          // tenta pegar nome do projeto (se tiver)
          let projectNameOrId: string | null = task.projectId ?? null;
          if (task.projectId) {
            const proj = await prisma.project.findUnique({
              where: { id: task.projectId },
              select: { name: true },
            });
            if (proj?.name) projectNameOrId = proj.name;
          }

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: taskDetailsModalView({
              title: task.title,
              responsibleSlackId: task.responsible,
              delegationSlackId: task.delegation ?? null,
              dueDateIso,
              deadlineTime: task.deadlineTime ?? null,
              urgency: task.urgency as any,
              recurrence: (task.recurrence as any) ?? null,
              projectNameOrId,
              description: task.description ?? null,
            }),
          });

          return reply.status(200).send();
        }

        // Checkbox: só seleciona
        if (actionId === TASK_SELECT_ACTION_ID) return reply.status(200).send();

        // placeholders (mantém sem quebrar)
        if (
          actionId === DELEGATED_SEND_FUP_ACTION_ID ||
          actionId === RECURRENCE_CANCEL_ACTION_ID ||
          actionId === PROJECT_VIEW_ACTION_ID ||
          actionId === PROJECT_CREATE_TASK_ACTION_ID ||
          actionId === PROJECT_EDIT_ACTION_ID
        ) {
          return reply.status(200).send();
        }

        return reply.status(200).send();
      }

      // =========================================================
      // 2) VIEW SUBMISSION
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

          const dueDate = getSelectedDate(values, "due_block", "due_date");
          const termDate: Date | null = dueDate ? new Date(`${dueDate}T03:00:00.000Z`) : null;

          const deadlineTime = getSelectedTime(values, TASK_TIME_BLOCK_ID, TASK_TIME_ACTION_ID);

          const recurrence = getSelectedOptionValue(values, TASK_RECURRENCE_BLOCK_ID, TASK_RECURRENCE_ACTION_ID);
          const projectId = getSelectedOptionValue(values, TASK_PROJECT_BLOCK_ID, TASK_PROJECT_ACTION_ID);

          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!userId) return reply.send({});
          if (!title || !responsible) return reply.send({});

          const task = await createTaskService({
            title,
            description,
            delegation: userId,
            responsible,
            term: termDate,
            deadlineTime: deadlineTime ?? null,
            recurrence: recurrence ?? null,
            projectId: projectId ?? null,
            urgency,
            carbonCopies,
          });

          try {
            await notifyTaskCreated({
              slack,
              taskId: task.id,
              createdBy: userId,
              taskTitle: title,
              responsible,
              carbonCopies,
            });
          } catch (e) {
            req.log.error({ e, taskId: task.id }, "[INTERACTIVE] notify failed");
          }

          try {
            await publishHome(slack, userId);
            if (responsible && responsible !== userId) await publishHome(slack, responsible);
          } catch (e) {
            req.log.error({ e }, "[INTERACTIVE] publishHome failed");
          }

          return reply.send({});
        }

        // -------------------------
        // EDIT TASK (PATCH via updateTaskService único)
        // -------------------------
        // -------------------------
        // EDIT TASK (PATCH via updateTaskService)
        // -------------------------
        if (cb === EDIT_TASK_MODAL_CALLBACK_ID) {
          if (!userId) return reply.send({});

          const values = payload.view?.state?.values;

          const title = (getInputValue(values, EDIT_TITLE_BLOCK_ID, EDIT_TITLE_ACTION_ID) ?? "").trim();
          const descRaw = getInputValue(values, EDIT_DESC_BLOCK_ID, EDIT_DESC_ACTION_ID);
          const description = descRaw?.trim() ? descRaw.trim() : null;

          const termIso = getSelectedDate(values, EDIT_TERM_BLOCK_ID, EDIT_TERM_ACTION_ID) ?? null; // YYYY-MM-DD | null
          const deadlineTime = getSelectedTime(values, EDIT_TIME_BLOCK_ID, EDIT_TIME_ACTION_ID) ?? null; // HH:MM | null

          if (!title) {
            return reply.send({
              response_action: "errors",
              errors: { [EDIT_TITLE_BLOCK_ID]: "Informe o nome da tarefa." },
            });
          }

          let taskId = "";
          try {
            const meta = JSON.parse(payload.view.private_metadata ?? "{}");
            taskId = String(meta.taskId ?? "");
          } catch { }

          if (!taskId) return reply.send({});

          // Atualiza (patch seguro)
          const updated = await updateTaskService({
            taskId,
            delegationSlackId: userId,
            title,
            description,
            termIso,
            deadlineTime,
          });

          // Notifica: responsável + CCs (união antes/depois)
          const allCc = Array.from(
            new Set([...(updated.before.carbonCopies ?? []), ...(updated.after.carbonCopies ?? [])])
          );

          await Promise.allSettled([
            notifyTaskEdited({
              slack,
              taskTitle: updated.after.title,
              editedBy: userId,
              responsible: updated.after.responsible,
              carbonCopies: allCc,
            }),
          ]);

          // Atualiza home: delegador (userId), responsável, CCs (união)
          const affectedUsers = new Set<string>();
          affectedUsers.add(userId);
          affectedUsers.add(updated.after.responsible);
          for (const cc of allCc) affectedUsers.add(cc);

          await Promise.allSettled(Array.from(affectedUsers).map((uid) => publishHome(slack, uid)));

          return reply.send({});
        }


        // -------------------------
        // RESCHEDULE TASK (patch + DM em grupo)
        // -------------------------
        if (cb === RESCHEDULE_TASK_MODAL_CALLBACK_ID) {
          if (!userId) return reply.send({});

          const values = payload.view?.state?.values;

          const newDateIso: string | null =
            values?.[RESCHEDULE_TERM_BLOCK_ID]?.[RESCHEDULE_TERM_ACTION_ID]?.selected_date ?? null;

          const newTime: string | null =
            values?.[RESCHEDULE_TIME_BLOCK_ID]?.[RESCHEDULE_TIME_ACTION_ID]?.selected_time ?? null;

          if (!newDateIso) {
            return reply.send({
              response_action: "errors",
              errors: { [RESCHEDULE_TERM_BLOCK_ID]: "Informe a data do novo prazo." },
            });
          }

          let taskId = "";
          try {
            const meta = JSON.parse(payload.view.private_metadata ?? "{}");
            taskId = String(meta.taskId ?? "");
          } catch { }

          if (!taskId) return reply.send({});

          await rescheduleTaskService({
            taskId,
            requesterSlackId: userId,
            newDateIso,
            newTime,
          });

          const after = await prisma.task.findUnique({
            where: { id: taskId },
            select: {
              id: true,
              title: true,
              responsible: true,
              delegation: true,
              carbonCopies: { select: { slackUserId: true } },
            },
          });

          if (after) {
            const br = formatDateBRFromIso(newDateIso);
            const newDateBr = newTime?.trim() ? `${br} às ${newTime.trim()}` : br;

            await Promise.allSettled([
              notifyTaskRescheduledGroup({
                slack,
                responsibleSlackId: after.responsible,
                delegationSlackId: after.delegation ?? null,
                carbonCopiesSlackIds: after.carbonCopies.map((c) => c.slackUserId),
                taskTitle: after.title,
                newDateBr,
              }),

              publishHome(slack, after.responsible),
              ...(after.delegation ? [publishHome(slack, after.delegation)] : []),
              ...Array.from(new Set(after.carbonCopies.map((c) => c.slackUserId))).map((uid) => publishHome(slack, uid)),
            ]);
          } else {
            await publishHome(slack, userId);
          }

          return reply.send({});
        }

        // -------------------------
        // SEND BATCH (placeholder)
        // -------------------------
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          return reply.send({});
        }

        // -------------------------
        // CREATE PROJECT
        // -------------------------
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const name = (getInputValue(values, PROJECT_NAME_BLOCK_ID, PROJECT_NAME_ACTION_ID) ?? "").trim();

          const descRaw = getInputValue(values, PROJECT_DESC_BLOCK_ID, PROJECT_DESC_ACTION_ID);
          const description = descRaw?.trim() ? descRaw.trim() : null;

          const endDateStr = getSelectedDate(values, PROJECT_END_BLOCK_ID, PROJECT_END_ACTION_ID);
          const endDate = endDateStr ? new Date(endDateStr) : null;

          const memberIds = getSelectedUsers(values, PROJECT_MEMBERS_BLOCK_ID, PROJECT_MEMBERS_ACTION_ID);

          if (!name) {
            return reply.send({
              response_action: "errors",
              errors: { [PROJECT_NAME_BLOCK_ID]: "Informe o nome do projeto." },
            });
          }

          if (!userId) return reply.send({});

          await createProjectService(slack, {
            name,
            description,
            endDate,
            memberSlackIds: memberIds,
            createdBySlackId: userId,
          });

          await Promise.allSettled(
            Array.from(new Set([...(memberIds ?? []), userId])).map((id) => publishHome(slack, id))
          );

          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      req.log.error({ err }, "[INTERACTIVE] error");
      return reply.status(200).send();
    }
  });
}
