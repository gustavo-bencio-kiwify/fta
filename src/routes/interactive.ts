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
  TASK_DEPENDS_BLOCK_ID,
  TASK_DEPENDS_ACTION_ID,
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
  EDIT_RESP_BLOCK_ID,
  EDIT_RESP_ACTION_ID,
  EDIT_CC_BLOCK_ID,
  EDIT_CC_ACTION_ID,
  EDIT_RECURRENCE_BLOCK_ID,
  EDIT_RECURRENCE_ACTION_ID,
} from "../views/editTaskModal";

import {
  projectViewModalView,
  PROJECT_VIEW_MODAL_CALLBACK_ID,
  PROJECT_MODAL_FILTER_ACTION_ID,
  PROJECT_MODAL_PAGE_PREV_ACTION_ID,
  PROJECT_MODAL_PAGE_NEXT_ACTION_ID,
  type ProjectModalFilter,
} from "../views/projectViewModal";

import { prisma } from "../lib/prisma";
import { createTaskService } from "../services/createTaskService";
import { updateTaskService } from "../services/updateTaskService";
import { getProjectViewModalData } from "../services/getProjectViewModalData";

import { notifyTaskCreated, TASK_DETAILS_CONCLUDE_ACTION_ID } from "../services/notifyTaskCreated";
import { notifyTaskCompleted, TASK_REOPEN_ACTION_ID } from "../services/notifyTaskCompleted";

import { syncCalendarEventForTask, deleteCalendarEventForTask } from "../services/googleCalendar";

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

function parseProjectModalState(view: any): { projectId: string; page: number; filter: ProjectModalFilter } | null {
  try {
    const raw = view?.private_metadata;
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.projectId) return null;
    return {
      projectId: String(obj.projectId),
      page: Number(obj.page ?? 1) || 1,
      filter: (obj.filter as ProjectModalFilter) ?? "todas",
    };
  } catch {
    return null;
  }
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

async function sendBotDm(slack: WebClient, userSlackId: string, text: string) {
  const conv = await slack.conversations.open({ users: userSlackId });
  const channelId = conv.channel?.id;
  if (!channelId) return;
  await slack.chat.postMessage({ channel: channelId, text });
}

/**
 * =========================================================
 * ✅ EMAIL SYNC (Slack -> DB)
 * - Requer scope Slack: users:read.email
 * - Salva:
 *   Task.delegationEmail / Task.responsibleEmail
 *   TaskCarbonCopy.email
 * =========================================================
 */
const slackEmailCache = new Map<string, string | null>();

async function getSlackUserEmail(slack: WebClient, userId: string): Promise<string | null> {
  if (!userId) return null;
  if (slackEmailCache.has(userId)) return slackEmailCache.get(userId)!;

  try {
    const res = await slack.users.info({ user: userId });
    const email = (res.user as any)?.profile?.email;
    const finalEmail = typeof email === "string" && email.includes("@") ? email : null;
    slackEmailCache.set(userId, finalEmail);
    return finalEmail;
  } catch {
    // comum: missing_scope
    slackEmailCache.set(userId, null);
    return null;
  }
}

async function syncTaskParticipantEmails(args: {
  slack: WebClient;
  taskId: string;
  delegationSlackId: string;
  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
}) {
  const { slack, taskId, delegationSlackId, responsibleSlackId, carbonCopiesSlackIds } = args;

  const [delegationEmail, responsibleEmail] = await Promise.all([
    getSlackUserEmail(slack, delegationSlackId),
    getSlackUserEmail(slack, responsibleSlackId),
  ]);

  await prisma.task.update({
    where: { id: taskId },
    data: {
      delegationEmail: delegationEmail ?? null,
      responsibleEmail: responsibleEmail ?? null,
    },
  });

  const ccIds = Array.from(new Set((carbonCopiesSlackIds ?? []).filter(Boolean)));
  if (!ccIds.length) return;

  const emails = await Promise.all(ccIds.map((id) => getSlackUserEmail(slack, id)));

  // atualiza email de cada CC no relacionamento
  await Promise.allSettled(
    ccIds.map((slackUserId, i) =>
      prisma.taskCarbonCopy.updateMany({
        where: { taskId, slackUserId },
        data: { email: emails[i] ?? null },
      })
    )
  );
}

export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  /**
   * ✅ /slack/options
   * - Endpoint exclusivo para external_select (block_suggestion)
   * - Configure no Slack: "Select Menus → Options Load URL"
   */
  app.post("/options", async (req, reply) => {
    req.log.info("[OPTIONS] HIT");

    const payload = parseSlackPayload(req.body);
    if (!payload) return reply.status(200).send({ options: [] });

    if (payload.type !== "block_suggestion" && payload.type !== "block_suggestions") {
      return reply.status(200).send({ options: [] });
    }

    const userSlackId = payload.user?.id as string | undefined;
    const actionId = String(payload.action_id ?? "");
    const query = String(payload.value ?? "").trim();

    req.log.info({ actionId, query, userSlackId }, "[OPTIONS] payload");

    if (!userSlackId) return reply.status(200).send({ options: [] });
    if (actionId !== TASK_DEPENDS_ACTION_ID) return reply.status(200).send({ options: [] });

    const where: any = {
      status: { not: "done" },
      OR: [
        { responsible: userSlackId },
        { delegation: userSlackId },
        // ✅ FIX: relação precisa comparar o slackUserId com userSlackId
        { carbonCopies: { some: { slackUserId: userSlackId } } },
      ],
    };

    // ✅ só filtra se digitou algo; se vazio, lista as mais recentes
    if (query) where.title = { contains: query, mode: "insensitive" };

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: { id: true, title: true },
    });

    return reply.status(200).send({
      options: tasks.map((t) => ({
        text: { type: "plain_text", text: t.title.slice(0, 75) },
        value: t.id,
      })),
    });
  });

  /**
   * ✅ /slack/interactive
   * - Interactivity Request URL do Slack
   */
  app.post("/interactive", async (req, reply) => {
    try {
      req.log.info("[INTERACTIVE] HIT");

      const payload = parseSlackPayload(req.body);
      if (!payload) return reply.status(200).send();

      const userSlackId = payload.user?.id as string | undefined;

      // =========================================================
      // 1) BLOCK ACTIONS
      // =========================================================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        // ---- Topo (Home Header)
        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          const projects =
            userSlackId
              ? await prisma.project.findMany({
                where: { status: "active", members: { some: { slackUserId: userSlackId } } },
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

        // =========================================================
        // ✅ REABRIR (na thread de conclusão)
        // - Se a task era recorrente, apaga a próxima instância criada automaticamente
        //   (para não ficar duplicada quando você reabrir)
        // =========================================================
        if (actionId === TASK_REOPEN_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          // ACK rápido
          reply.status(200).send();

          void (async () => {
            const oldTaskId = String(action?.value ?? "").trim();
            if (!oldTaskId) return;

            const oldTask = await prisma.task.findUnique({
              where: { id: oldTaskId },
              select: {
                id: true,
                title: true,
                description: true,
                delegation: true,
                responsible: true,
                term: true,
                deadlineTime: true,
                recurrence: true,
                projectId: true,
                dependsOnId: true,
                urgency: true,
                createdAt: true,
                updatedAt: true,
                carbonCopies: { select: { slackUserId: true } },
              },
            });

            if (!oldTask) return;

            // =========================================================
            // ✅ 1) Se era recorrente: apaga a próxima instância gerada
            // =========================================================
            if (oldTask.recurrence) {
              try {
                // janela baseada no "momento da conclusão" (updatedAt costuma bater com o update do status done)
                const base = oldTask.updatedAt ?? new Date();
                const windowStart = new Date(base.getTime() - 2 * 60 * 1000);
                const windowEnd = new Date(base.getTime() + 10 * 60 * 1000);

                const whereNext: any = {
                  id: { not: oldTask.id },
                  status: { not: "done" },
                  recurrence: oldTask.recurrence,
                  responsible: oldTask.responsible,
                  projectId: oldTask.projectId ?? null,
                  createdAt: { gte: windowStart, lte: windowEnd },
                };

                // se a task antiga tem term, a próxima costuma ser > term
                if (oldTask.term) whereNext.term = { gt: oldTask.term };

                // se tinha delegation definida, tenta casar igual (ajuda a acertar o alvo)
                if (oldTask.delegation) whereNext.delegation = oldTask.delegation;

                const nextAuto = await prisma.task.findFirst({
                  where: whereNext,
                  orderBy: [{ createdAt: "asc" }],
                  select: { id: true },
                });

                if (nextAuto) {
                  // remove calendário da próxima antes de deletar (se existir)
                  await deleteCalendarEventForTask(nextAuto.id).catch(() => { });
                  await prisma.task.delete({ where: { id: nextAuto.id } });

                  req.log.info(
                    { oldTaskId: oldTask.id, deletedNextId: nextAuto.id },
                    "[REOPEN] deleted next recurring instance before reopening"
                  );
                }
              } catch (e) {
                req.log.error({ e, oldTaskId: oldTask.id }, "[REOPEN] failed to delete next recurring instance");
              }
            }

            // =========================================================
            // ✅ 2) Reabre (cria nova task) normalmente
            // =========================================================
            const newTask = await createTaskService({
              title: oldTask.title,
              description: oldTask.description ?? undefined,
              delegation: oldTask.delegation ?? userSlackId,
              responsible: oldTask.responsible,
              term: oldTask.term ?? null,
              deadlineTime: oldTask.deadlineTime ?? null,
              recurrence: oldTask.recurrence ?? null,
              projectId: oldTask.projectId ?? null,
              dependsOnId: oldTask.dependsOnId ?? null,
              urgency: (oldTask.urgency as any) ?? "light",
              carbonCopies: oldTask.carbonCopies.map((c) => c.slackUserId),
            });

            // ✅ salva emails + sincroniza calendar da nova task
            try {
              await syncTaskParticipantEmails({
                slack,
                taskId: newTask.id,
                delegationSlackId: newTask.delegation ?? userSlackId,
                responsibleSlackId: newTask.responsible,
                carbonCopiesSlackIds: newTask.carbonCopies.map((c) => c.slackUserId),
              });

              await syncCalendarEventForTask(newTask.id);
            } catch (e) {
              req.log.error({ e, taskId: newTask.id }, "[REOPEN] email/calendar sync failed");
            }

            const channelFromPayload = payload?.container?.channel_id ?? payload?.channel?.id ?? null;
            const threadTs = payload?.container?.thread_ts ?? payload?.container?.message_ts ?? null;

            if (channelFromPayload && threadTs) {
              await slack.chat.postMessage({
                channel: channelFromPayload,
                thread_ts: threadTs,
                text: `🔁 Reaberta como nova tarefa: *${newTask.title}* (UID: \`${newTask.id}\`)`,
              });
            }

            // ✅ Se reaberta tiver dependência ainda não done, adia notificação
            let deferNotifyCreated = false;
            if (newTask.dependsOnId) {
              const dep = await prisma.task.findUnique({
                where: { id: newTask.dependsOnId },
                select: { status: true },
              });
              deferNotifyCreated = dep?.status !== "done";
            }

            if (!deferNotifyCreated) {
              await notifyTaskCreated({
                slack,
                taskId: newTask.id,
                createdBy: newTask.delegation ?? userSlackId,
                taskTitle: newTask.title,
                responsible: newTask.responsible,
                carbonCopies: newTask.carbonCopies.map((c) => c.slackUserId),
                term: newTask.term,
                deadlineTime: (newTask as any).deadlineTime ?? null,
              });
            } else {
              req.log.info(
                { taskId: newTask.id, dependsOnId: newTask.dependsOnId },
                "[REOPEN] notifyTaskCreated deferred (blocked by dependency)"
              );
            }

            // atualiza homes
            const affected = new Set<string>();
            affected.add(userSlackId);
            affected.add(newTask.responsible);
            if (newTask.delegation) affected.add(newTask.delegation);
            for (const c of newTask.carbonCopies) affected.add(c.slackUserId);

            if (newTask.projectId) {
              const proj = await prisma.project.findUnique({
                where: { id: newTask.projectId },
                select: { members: { select: { slackUserId: true } } },
              });
              proj?.members?.forEach((m) => affected.add(m.slackUserId));
            }

            await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));
          })().catch((err) => {
            req.log.error({ err }, "[INTERACTIVE] task_reopen failed");
          });

          return;
        }


        // ============================
        // ✅ CONCLUIR (Home) + Concluir (DM da task)
        // ============================
        if (actionId === TASKS_CONCLUDE_SELECTED_ACTION_ID || actionId === TASK_DETAILS_CONCLUDE_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const selectedIds =
            actionId === TASK_DETAILS_CONCLUDE_ACTION_ID
              ? [String(action?.value ?? "")]
              : getSelectedTaskIdsFromHome(payload);

          if (!selectedIds.length) {
            await publishHome(slack, userSlackId);
            return reply.status(200).send();
          }

          const tasksToConclude = await prisma.task.findMany({
            where: {
              id: { in: selectedIds },
              status: { not: "done" },
              OR: [
                { responsible: userSlackId }, // responsável pode concluir
                { delegation: userSlackId },  // delegador também pode concluir
              ],
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
            await publishHome(slack, userSlackId);
            return reply.status(200).send();
          }

          const concludedIds = tasksToConclude.map((t) => t.id);

          await prisma.task.updateMany({
            where: {
              id: { in: concludedIds },
              status: { not: "done" },
              OR: [
                { responsible: userSlackId },
                { delegation: userSlackId },
              ],
            },
            data: { status: "done" },
          });


          // ✅ remove da agenda (status done => sync apaga)
          void Promise.allSettled(concludedIds.map((id) => syncCalendarEventForTask(id))).catch(() => { });

          // ✅ recorrência
          await Promise.allSettled(concludedIds.map((id) => createNextRecurringTaskFromCompleted({ completedTaskId: id })));

          // ✅ notifica conclusão (thread + botão reabrir + update "✅ Concluída")
          await Promise.allSettled(
            concludedIds.map((id) =>
              notifyTaskCompleted({
                slack,
                taskId: id,
                completedBySlackId: userSlackId,
              })
            )
          );

          // ✅ atualiza envolvidos (dependentes)
          const dependents = await prisma.task.findMany({
            where: {
              status: { not: "done" },
              dependsOnId: { in: concludedIds },
            },
            select: {
              responsible: true,
              delegation: true,
              carbonCopies: { select: { slackUserId: true } },
            },
            take: 200,
          });

          // ✅ NOVO: ao concluir o "pai", dispara notifyTaskCreated para dependentes desbloqueadas
          const unlockedDependents = await prisma.task.findMany({
            where: {
              status: { not: "done" },
              dependsOnId: { in: concludedIds },
              slackOpenMessageTs: null, // só as que ainda não receberam DM
            },
            select: {
              id: true,
              title: true,
              term: true,
              deadlineTime: true,
              responsible: true,
              delegation: true,
              carbonCopies: { select: { slackUserId: true } },
            },
            take: 200,
          });

          await Promise.allSettled(
            unlockedDependents.map((t) =>
              notifyTaskCreated({
                slack,
                taskId: t.id,
                createdBy: (t.delegation as any) ?? t.responsible, // delegation é obrigatório no seu schema, mas fallback defensivo
                taskTitle: t.title,
                responsible: t.responsible,
                carbonCopies: t.carbonCopies.map((c) => c.slackUserId),
                term: t.term,
                deadlineTime: (t as any).deadlineTime ?? null,
              })
            )
          );

          const affected = new Set<string>();
          affected.add(userSlackId);

          for (const t of tasksToConclude) {
            if (t.delegation) affected.add(t.delegation);
          }

          for (const d of dependents) {
            affected.add(d.responsible);
            if (d.delegation) affected.add(d.delegation);
            for (const c of d.carbonCopies) affected.add(c.slackUserId);
          }

          await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));

          return reply.status(200).send();
        }

        // ---- Refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userSlackId) await publishHome(slack, userSlackId);
          return reply.status(200).send();
        }

        // ---- Enviar dúvida
        if (actionId === TASKS_SEND_QUESTION_ACTION_ID || actionId === CC_SEND_QUESTION_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const value = (action?.value ?? "").toString();
          const valueIsTaskId = isUuid(value);
          const taskIds = valueIsTaskId ? [value] : getSelectedTaskIdsFromHome(payload);

          if (!taskIds.length) return reply.status(200).send();

          await Promise.all(
            taskIds.map(async (taskId) => {
              try {
                await openQuestionThread({ slack, taskId, requestedBy: userSlackId });
              } catch (e) {
                req.log.error({ e, taskId }, "[INTERACTIVE] openQuestionThread failed");
              }
            })
          );

          return reply.status(200).send();
        }

        // ---- ✅ Concluir Projeto (SÓ O CRIADOR)
        if (actionId === PROJECT_CONCLUDE_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const projectId = String(action?.value ?? "").trim();
          if (!projectId) return reply.status(200).send();

          const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: {
              id: true,
              name: true,
              status: true,
              createdBySlackId: true,
              members: { select: { slackUserId: true }, orderBy: { createdAt: "asc" } },
            },
          });

          if (!project || project.status !== "active") {
            await publishHome(slack, userSlackId);
            return reply.status(200).send();
          }

          const isMember = project.members.some((m) => m.slackUserId === userSlackId);
          if (!isMember) {
            await sendBotDm(slack, userSlackId, "⛔ Você não é membro deste projeto.");
            return reply.status(200).send();
          }

          const fallbackCreator = project.members[0]?.slackUserId ?? null;
          const creatorId = project.createdBySlackId ?? fallbackCreator;

          if (!creatorId || creatorId !== userSlackId) {
            await sendBotDm(slack, userSlackId, `⛔ Apenas o criador do projeto pode concluir *${project.name}*.`);
            return reply.status(200).send();
          }

          await prisma.project.update({
            where: { id: project.id },
            data: { status: "concluded", concludedAt: new Date() },
          });

          await sendBotDm(slack, userSlackId, `✅ Projeto *${project.name}* foi concluído e arquivado.`);

          const members = await prisma.projectMember.findMany({
            where: { projectId: project.id },
            select: { slackUserId: true },
          });

          await Promise.allSettled(
            Array.from(new Set([userSlackId, ...members.map((m) => m.slackUserId)])).map((uid) => publishHome(slack, uid))
          );

          return reply.status(200).send();
        }

        // ---- Reprogramar Prazo (abre modal)
        if (actionId === TASKS_RESCHEDULE_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const selectedIds = getSelectedTaskIdsFromHome(payload);

          if (selectedIds.length !== 1) {
            await sendBotDm(slack, userSlackId, "⚠️ Selecione apenas *1* tarefa por vez para reprogramar.");
            await publishHome(slack, userSlackId);
            return reply.status(200).send();
          }

          const taskId = selectedIds[0];

          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              status: { not: "done" },
              OR: [{ responsible: userSlackId }, { delegation: userSlackId }],
            },
            select: { id: true, title: true, term: true, deadlineTime: true },
          });

          if (!task) {
            await sendBotDm(slack, userSlackId, "Não encontrei essa tarefa (ou você não tem permissão para reprogramar).");
            await publishHome(slack, userSlackId);
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
          if (!userSlackId) return reply.status(200).send();

          // ✅ ACK IMEDIATO
          reply.status(200).send();

          void (async () => {
            const selectedIds = getSelectedTaskIdsFromHome(payload);
            if (!selectedIds.length) {
              await publishHome(slack, userSlackId);
              return;
            }

            const tasksToDelete = await prisma.task.findMany({
              where: {
                id: { in: selectedIds },
                delegation: userSlackId,
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

            if (!tasksToDelete.length) {
              await publishHome(slack, userSlackId);
              return;
            }

            await Promise.allSettled(
              tasksToDelete.map((t) =>
                notifyTaskCanceledGroup({
                  slack,
                  canceledBySlackId: userSlackId,
                  responsibleSlackId: t.responsible,
                  carbonCopiesSlackIds: t.carbonCopies.map((c) => c.slackUserId),
                  taskTitle: t.title,
                })
              )
            );

            // ✅ remove da agenda antes de deletar
            await Promise.allSettled(tasksToDelete.map((t) => deleteCalendarEventForTask(t.id)));

            await prisma.task.deleteMany({
              where: {
                id: { in: tasksToDelete.map((t) => t.id) },
                delegation: userSlackId,
              },
            });

            const affectedUsers = new Set<string>();
            affectedUsers.add(userSlackId);
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
          if (!userSlackId) return reply.status(200).send();

          const selectedIds = getSelectedTaskIdsFromHome(payload);
          if (!selectedIds.length) return reply.status(200).send();

          const taskId = selectedIds[0];

          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              status: { not: "done" },
              delegation: userSlackId,
            },
            select: {
              id: true,
              title: true,
              description: true,
              term: true,
              deadlineTime: true,
              responsible: true,
              recurrence: true,
              carbonCopies: { select: { slackUserId: true } },
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
              responsibleSlackId: task.responsible,
              carbonCopiesSlackIds: task.carbonCopies.map((c) => c.slackUserId),
              recurrence: task.recurrence ?? null,
            } as any),
          });

          return reply.status(200).send();
        }

        // ---- Ver detalhes (abre modal)
        if (actionId === TASKS_VIEW_DETAILS_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const value = (action?.value ?? "").toString();
          const valueIsTaskId = isUuid(value);
          const selectedIds = valueIsTaskId ? [value] : getSelectedTaskIdsFromHome(payload);

          if (selectedIds.length !== 1) {
            await sendBotDm(slack, userSlackId, "🔎 Selecione *1* tarefa para ver os detalhes.");
            return reply.status(200).send();
          }

          const taskId = selectedIds[0];

          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              OR: [
                { responsible: userSlackId },
                { delegation: userSlackId },
                { carbonCopies: { some: { slackUserId: userSlackId } } },
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
            await sendBotDm(slack, userSlackId, "Não encontrei essa tarefa (ou você não tem permissão para ver).");
            return reply.status(200).send();
          }

          const dueDateIso = task.term ? task.term.toISOString().slice(0, 10) : null;

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

        // =========================================================
        // ✅ PROJECT VIEW MODAL: abrir / filtrar / paginar
        // =========================================================
        if (actionId === PROJECT_VIEW_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const projectId = String(action?.value ?? "").trim();
          if (!projectId) return reply.status(200).send();

          const data = await getProjectViewModalData({
            slackUserId: userSlackId,
            projectId,
            page: 1,
            filter: "todas",
          });

          if (!data) {
            await publishHome(slack, userSlackId);
            return reply.status(200).send();
          }

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: projectViewModalView({
              projectId: data.project.id,
              projectName: data.project.name,
              stats: data.stats,
              tasks: data.tasks,
              page: data.page,
              totalPages: data.totalPages,
              filter: data.filter,
            }),
          });

          return reply.status(200).send();
        }

        if (actionId === PROJECT_MODAL_FILTER_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const st = parseProjectModalState(payload.view);
          if (!st) return reply.status(200).send();

          const newFilter = String(action?.selected_option?.value ?? "todas") as ProjectModalFilter;

          const data = await getProjectViewModalData({
            slackUserId: userSlackId,
            projectId: st.projectId,
            page: 1,
            filter: newFilter,
          });

          if (!data) return reply.status(200).send();

          await slack.views.update({
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: projectViewModalView({
              projectId: data.project.id,
              projectName: data.project.name,
              stats: data.stats,
              tasks: data.tasks,
              page: data.page,
              totalPages: data.totalPages,
              filter: data.filter,
            }),
          });

          return reply.status(200).send();
        }

        if (actionId === PROJECT_MODAL_PAGE_PREV_ACTION_ID || actionId === PROJECT_MODAL_PAGE_NEXT_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const st = parseProjectModalState(payload.view);
          if (!st) return reply.status(200).send();

          const nextPage = actionId === PROJECT_MODAL_PAGE_NEXT_ACTION_ID ? st.page + 1 : st.page - 1;

          const data = await getProjectViewModalData({
            slackUserId: userSlackId,
            projectId: st.projectId,
            page: nextPage,
            filter: st.filter,
          });

          if (!data) return reply.status(200).send();

          await slack.views.update({
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: projectViewModalView({
              projectId: data.project.id,
              projectName: data.project.name,
              stats: data.stats,
              tasks: data.tasks,
              page: data.page,
              totalPages: data.totalPages,
              filter: data.filter,
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

        // -------------------------
        // CREATE TASK ✅ (notifica + publishHome)
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

          const dependsOnId = getSelectedOptionValue(values, TASK_DEPENDS_BLOCK_ID, TASK_DEPENDS_ACTION_ID) ?? null;

          const recurrence = getSelectedOptionValue(values, TASK_RECURRENCE_BLOCK_ID, TASK_RECURRENCE_ACTION_ID);
          const projectId = getSelectedOptionValue(values, TASK_PROJECT_BLOCK_ID, TASK_PROJECT_ACTION_ID);

          const urgency = getSelectedOptionValue(values, "urgency_block", "urgency") ?? "light";
          const carbonCopies = getSelectedUsers(values, "cc_block", "carbon_copies");

          if (!userSlackId) return reply.send({});
          if (!title || !responsible) return reply.send({});

          const task = await createTaskService({
            title,
            description,
            delegation: userSlackId,
            responsible,
            term: termDate,
            deadlineTime: deadlineTime ?? null,
            recurrence: recurrence ?? null,
            projectId: projectId ?? null,
            dependsOnId,
            urgency,
            carbonCopies,
          });

          // ACK
          reply.send({});

          void (async () => {
            // ✅ salva emails + sincroniza calendário (attendees)
            try {
              await syncTaskParticipantEmails({
                slack,
                taskId: task.id,
                delegationSlackId: userSlackId,
                responsibleSlackId: task.responsible,
                carbonCopiesSlackIds: task.carbonCopies.map((c) => c.slackUserId),
              });

              await syncCalendarEventForTask(task.id);
            } catch (e) {
              req.log.error({ e, taskId: task.id }, "[CREATE_TASK] email/calendar sync failed");
            }

            // ✅ NOVO: se depende de outra task ainda não done, adia DM de "task criada"
            let deferNotifyCreated = false;
            if (dependsOnId) {
              const dep = await prisma.task.findUnique({
                where: { id: dependsOnId },
                select: { status: true },
              });
              deferNotifyCreated = dep?.status !== "done";
            }

            if (!deferNotifyCreated) {
              await notifyTaskCreated({
                slack,
                taskId: task.id,
                createdBy: userSlackId,
                taskTitle: task.title,
                responsible: task.responsible,
                carbonCopies: task.carbonCopies.map((c) => c.slackUserId),
                term: task.term,
                deadlineTime: (task as any).deadlineTime ?? null,
              });
            } else {
              req.log.info({ taskId: task.id, dependsOnId }, "[CREATE_TASK] notifyTaskCreated deferred (blocked by dependency)");
            }

            const affected = new Set<string>();
            affected.add(userSlackId);
            affected.add(task.responsible);
            if (task.delegation) affected.add(task.delegation);
            for (const c of task.carbonCopies) affected.add(c.slackUserId);

            if (task.projectId) {
              const proj = await prisma.project.findUnique({
                where: { id: task.projectId },
                select: { members: { select: { slackUserId: true } } },
              });
              proj?.members?.forEach((m) => affected.add(m.slackUserId));
            }

            await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));
          })().catch((err) => {
            req.log.error({ err, taskId: task.id }, "[CREATE_TASK] side-effects failed");
          });

          return;
        }

        // -------------------------
        // EDIT TASK (PATCH via updateTaskService)
        // -------------------------
        if (cb === EDIT_TASK_MODAL_CALLBACK_ID) {
          if (!userSlackId) return reply.send({});

          const values = payload.view?.state?.values;

          const title = (getInputValue(values, EDIT_TITLE_BLOCK_ID, EDIT_TITLE_ACTION_ID) ?? "").trim();

          const descRaw = getInputValue(values, EDIT_DESC_BLOCK_ID, EDIT_DESC_ACTION_ID);
          const description = descRaw?.trim() ? descRaw.trim() : null;

          const termIso = getSelectedDate(values, EDIT_TERM_BLOCK_ID, EDIT_TERM_ACTION_ID) ?? null;
          const deadlineTime = getSelectedTime(values, EDIT_TIME_BLOCK_ID, EDIT_TIME_ACTION_ID) ?? null;

          const responsibleSlackId = getSelectedUser(values, EDIT_RESP_BLOCK_ID, EDIT_RESP_ACTION_ID) ?? "";
          const carbonCopiesSlackIds = getSelectedUsers(values, EDIT_CC_BLOCK_ID, EDIT_CC_ACTION_ID);

          const recurrenceRaw =
            getSelectedOptionValue(values, EDIT_RECURRENCE_BLOCK_ID, EDIT_RECURRENCE_ACTION_ID) ?? "none";
          const recurrence = recurrenceRaw === "none" ? null : recurrenceRaw;

          if (!title) {
            return reply.send({
              response_action: "errors",
              errors: { [EDIT_TITLE_BLOCK_ID]: "Informe o título." },
            });
          }

          if (!responsibleSlackId) {
            return reply.send({
              response_action: "errors",
              errors: { [EDIT_RESP_BLOCK_ID]: "Selecione o responsável." },
            });
          }

          let taskId = "";
          try {
            const meta = JSON.parse(payload.view.private_metadata ?? "{}");
            taskId = String(meta.taskId ?? "");
          } catch { }

          if (!taskId) return reply.send({});

          const updated = await updateTaskService({
            taskId,
            delegationSlackId: userSlackId,
            title,
            description,
            termIso,
            deadlineTime,
            responsibleSlackId,
            carbonCopiesSlackIds,
            recurrence,
          });

          // ✅ salva emails + sincroniza agenda (mudou data/horário/attendees)
          try {
            await syncTaskParticipantEmails({
              slack,
              taskId,
              delegationSlackId: userSlackId,
              responsibleSlackId: updated.after.responsible,
              carbonCopiesSlackIds: updated.after.carbonCopies,
            });

            await syncCalendarEventForTask(taskId);
          } catch (e) {
            req.log.error({ e, taskId }, "[EDIT_TASK] email/calendar sync failed");
          }

          const allCc = Array.from(new Set([...(updated.before.carbonCopies ?? []), ...(updated.after.carbonCopies ?? [])]));

          await Promise.allSettled([
            notifyTaskEdited({
              slack,
              taskId, // ✅ novo
              taskTitle: updated.after.title,
              editedBy: userSlackId,
              responsible: updated.after.responsible,
              carbonCopies: allCc,
            }),
            ,
          ]);

          const affectedUsers = new Set<string>();
          affectedUsers.add(userSlackId);
          affectedUsers.add(updated.after.responsible);
          if (updated.after.delegation) affectedUsers.add(updated.after.delegation);
          for (const cc of allCc) affectedUsers.add(cc);

          await Promise.allSettled(Array.from(affectedUsers).map((uid) => publishHome(slack, uid)));

          return reply.send({});
        }

        // -------------------------
        // RESCHEDULE TASK
        // -------------------------
        if (cb === RESCHEDULE_TASK_MODAL_CALLBACK_ID) {
          if (!userSlackId) return reply.send({});

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
            requesterSlackId: userSlackId,
            newDateIso,
            newTime,
          });

          // ✅ sincroniza agenda (mudou data/horário)
          void syncCalendarEventForTask(taskId).catch((e) => {
            req.log.error({ e, taskId }, "[RESCHEDULE] calendar sync failed");
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
            await publishHome(slack, userSlackId);
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
          // ✅ evita “shift” de data: 00:00 SP = 03:00Z
          const endDate = endDateStr ? new Date(`${endDateStr}T03:00:00.000Z`) : null;

          const memberIds = getSelectedUsers(values, PROJECT_MEMBERS_BLOCK_ID, PROJECT_MEMBERS_ACTION_ID);

          if (!name) {
            return reply.send({
              response_action: "errors",
              errors: { [PROJECT_NAME_BLOCK_ID]: "Informe o nome do projeto." },
            });
          }

          if (!userSlackId) return reply.send({});

          await createProjectService(slack, {
            name,
            description,
            endDate,
            memberSlackIds: memberIds,
            createdBySlackId: userSlackId,
          });

          await Promise.allSettled(
            Array.from(new Set([...(memberIds ?? []), userSlackId])).map((id) => publishHome(slack, id))
          );

          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err: any) {
      // nunca deixa erro estourar pro Slack
      console.error("[INTERACTIVE] error:", err);
      return reply.status(200).send();
    }
  });
}
