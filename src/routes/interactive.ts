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
  TASK_CAL_PRIVATE_BLOCK_ID,
  TASK_CAL_PRIVATE_ACTION_ID,
} from "../views/createTaskModal";

import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { updateTaskOpenMessage } from "../services/updateTaskOpenMessage";
import { markTaskOpenMessageAsCanceled } from "../services/markTaskOpenMessageAsCanceled";
import { BATCH_ADD_TASK_ACTION_ID, BATCH_REMOVE_TASK_ACTION_ID } from "../views/sendBatchModal";
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
  HOME_FEEDBACK_OPEN_ACTION_ID,      // ✅ ADD
  HOME_FEEDBACK_ADMIN_ACTION_ID,     // ✅ ADD
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
  feedbackCreateModalView,
  feedbackAdminModalView,

  FEEDBACK_CREATE_CALLBACK_ID,

  FEEDBACK_TYPE_SELECT_ACTION_ID,
  FEEDBACK_TYPE_BLOCK_ID,
  FEEDBACK_TITLE_BLOCK_ID,
  FEEDBACK_DESC_BLOCK_ID,
  FEEDBACK_TITLE_INPUT_ACTION_ID,
  FEEDBACK_DESC_INPUT_ACTION_ID,

  FEEDBACK_ADMIN_FILTER_TYPE_BLOCK_ID,
  FEEDBACK_ADMIN_FILTER_TYPE_ACTION_ID,
  FEEDBACK_ADMIN_FILTER_STATUS_BLOCK_ID,
  FEEDBACK_ADMIN_FILTER_STATUS_ACTION_ID,

  FEEDBACK_SET_REJECTED_ACTION_ID,
  FEEDBACK_SET_WIP_ACTION_ID,
  FEEDBACK_SET_DONE_ACTION_ID,
  FEEDBACK_STATUS_MENU_ACTION_ID,

  type FeedbackTypeFilter,
  type FeedbackStatusFilter,
  type FeedbackItem,
} from "../views/feedbackModals";


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
  EDIT_URGENCY_BLOCK_ID,
  EDIT_URGENCY_ACTION_ID,
  EDIT_CAL_PRIVATE_BLOCK_ID,
  EDIT_CAL_PRIVATE_ACTION_ID,
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
import { sendImportTemplateDm } from "../services/sendImportTemplateDm";
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
import { handleTaskResponsibleReassign } from "../services/handleTaskResponsibleReassign";

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
function isCheckboxChecked(values: any, blockId: string, actionId: string, value: string) {
  const selected = values?.[blockId]?.[actionId]?.selected_options ?? [];
  return selected.some((o: any) => String(o?.value ?? "") === value);
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
 * ✅ FEEDBACK PERMISSIONS + LIST HELPERS
 * - Todos podem ver a lista
 * - Só admins (env FEEDBACK_ADMIN_SLACK_IDS) podem mudar status
 * =========================================================
 */
const FEEDBACK_LIST_TAKE = 25;

function getFeedbackAdminIds(): string[] {
  const raw = String(process.env.FEEDBACK_ADMIN_SLACK_IDS ?? "").trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

function isFeedbackAdmin(slackUserId: string | undefined | null): boolean {
  if (!slackUserId) return false;
  const admins = getFeedbackAdminIds();
  return admins.includes(slackUserId);
}

type FeedbackListFilters = {
  typeFilter: FeedbackTypeFilter;
  statusFilter: FeedbackStatusFilter;
};

function getFeedbackFiltersFromView(view: any): FeedbackListFilters {
  const values = view?.state?.values;

  const typeFilter =
    (values?.[FEEDBACK_ADMIN_FILTER_TYPE_BLOCK_ID]?.[FEEDBACK_ADMIN_FILTER_TYPE_ACTION_ID]?.selected_option?.value ??
      "all") as FeedbackTypeFilter;

  const statusFilter =
    (values?.[FEEDBACK_ADMIN_FILTER_STATUS_BLOCK_ID]?.[FEEDBACK_ADMIN_FILTER_STATUS_ACTION_ID]?.selected_option?.value ??
      "all") as FeedbackStatusFilter;

  return {
    typeFilter: (typeFilter as any) ?? "all",
    statusFilter: (statusFilter as any) ?? "all",
  };
}

async function fetchFeedbackList(filters: FeedbackListFilters) {
  const where: any = {};
  if (filters.typeFilter && filters.typeFilter !== "all") where.type = filters.typeFilter;
  if (filters.statusFilter && filters.statusFilter !== "all") where.status = filters.statusFilter;

  return prisma.feedback.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: FEEDBACK_LIST_TAKE,
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      status: true,
      createdBySlackId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function fetchMyOpenFeedback(args: { createdBySlackId: string; take?: number }): Promise<FeedbackItem[]> {
  const { createdBySlackId, take = 10 } = args;

  const rows = await prisma.feedback.findMany({
    where: {
      createdBySlackId,
      // ✅ "abertos" = pending ou wip
      status: { in: ["pending", "wip"] },
    },
    orderBy: [{ updatedAt: "desc" }],
    take,
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      status: true,
      createdBySlackId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows as any;
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

        // =========================================================
        // ✅ FEEDBACK
        // =========================================================
        if (actionId === HOME_FEEDBACK_OPEN_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: feedbackCreateModalView(),
          });

          return reply.status(200).send();
        }

        if (actionId === HOME_FEEDBACK_ADMIN_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const filters: FeedbackListFilters = { typeFilter: "all", statusFilter: "all" };
          const items = await fetchFeedbackList(filters);

          const myOpenItems = await fetchMyOpenFeedback({ createdBySlackId: userSlackId, take: 8 });

          await slack.views.open({
            trigger_id: payload.trigger_id,
            view: feedbackAdminModalView({
              items,
              typeFilter: filters.typeFilter,
              statusFilter: filters.statusFilter,
              canEdit: isFeedbackAdmin(userSlackId),
              myOpenItems,
            }),
          });

          return reply.status(200).send();
        }

        // filtros dentro do modal de listagem (qualquer um pode usar)
        if (actionId === FEEDBACK_ADMIN_FILTER_TYPE_ACTION_ID || actionId === FEEDBACK_ADMIN_FILTER_STATUS_ACTION_ID) {
          // ACK rápido
          reply.status(200).send();

          void (async () => {
            const view = payload.view;
            if (!view?.id) return;

            const filters = getFeedbackFiltersFromView(view);
            const items = await fetchFeedbackList(filters);

            const myOpenItems = await fetchMyOpenFeedback({ createdBySlackId: userSlackId!, take: 8 });

            await slack.views.update({
              view_id: view.id,
              hash: view.hash,
              view: feedbackAdminModalView({
                items,
                typeFilter: filters.typeFilter,
                statusFilter: filters.statusFilter,
                canEdit: isFeedbackAdmin(userSlackId),
                myOpenItems,
              }),
            });
          })().catch((e) => {
            req.log.error({ e }, "[FEEDBACK] filter update failed");
          });

          return;
        }

        // status no modal (só admin pode alterar)
        // - v1: botões
        // - v2: overflow menu à direita
        if (
          actionId === FEEDBACK_SET_REJECTED_ACTION_ID ||
          actionId === FEEDBACK_SET_WIP_ACTION_ID ||
          actionId === FEEDBACK_SET_DONE_ACTION_ID ||
          actionId === FEEDBACK_STATUS_MENU_ACTION_ID
        ) {
          reply.status(200).send(); // ACK

          void (async () => {
            let feedbackId = "";
            let nextStatus: "rejected" | "wip" | "done" | null = null;

            if (actionId === FEEDBACK_STATUS_MENU_ACTION_ID) {
              const raw = String(action?.selected_option?.value ?? "");
              const [id, st] = raw.split("|");
              feedbackId = String(id ?? "").trim();
              if (st === "rejected" || st === "wip" || st === "done") nextStatus = st;
            } else {
              feedbackId = String(action?.value ?? "").trim();
              nextStatus =
                actionId === FEEDBACK_SET_REJECTED_ACTION_ID
                  ? "rejected"
                  : actionId === FEEDBACK_SET_WIP_ACTION_ID
                    ? "wip"
                    : "done";
            }

            if (!feedbackId || !nextStatus) return;

            if (!isFeedbackAdmin(userSlackId)) {
              await sendBotDm(slack, userSlackId!, "⛔ Você não tem permissão para alterar o status.");
              return;
            }

            const existing = await prisma.feedback.findUnique({
              where: { id: feedbackId },
              select: {
                id: true,
                status: true,
                title: true,
                type: true,
                description: true,
                createdBySlackId: true,
              },
            });

            if (!existing) return;

            // ✅ Regra: se já está concluído, não volta pra nenhum outro status
            if (existing.status === "done" && nextStatus !== "done") {
              await sendBotDm(slack, userSlackId!, `⚠️ Este ticket já está *Concluído* e não pode voltar para outro status.`);
              return;
            }

            if (existing.status === nextStatus) return;

            await prisma.feedback.update({
              where: { id: feedbackId },
              data: { status: nextStatus as any },
            });

            // ✅ Ao concluir: abre DM em grupo (criador + admin) e cria uma thread
            if (existing.status !== "done" && nextStatus === "done") {
              try {
                const users = Array.from(new Set([existing.createdBySlackId, userSlackId!])).join(",");
                const conv = await slack.conversations.open({ users });
                const channelId = (conv as any)?.channel?.id as string | undefined;

                if (channelId) {
                  const parent = await slack.chat.postMessage({
                    channel: channelId,
                    text:
                      `✅ Ticket concluído por <@${userSlackId}>\n` +
                      `*${existing.title}*\n` +
                      `${existing.type === "bug" ? "🐞 Bug" : "💡 Sugestão"} • ID: \`${existing.id}\``,
                  });

                  const threadTs = (parent as any)?.ts as string | undefined;
                  if (threadTs) {
                    await slack.chat.postMessage({
                      channel: channelId,
                      thread_ts: threadTs,
                      text: `👀 <@${existing.createdBySlackId}>, se quiser validar ou detalhar a entrega, responda aqui nesta thread.`,
                    });

                    if ((existing.description ?? "").trim()) {
                      await slack.chat.postMessage({
                        channel: channelId,
                        thread_ts: threadTs,
                        text: `📝 *Descrição original:*\n${existing.description}`,
                      });
                    }
                  }
                }
              } catch (e) {
                req.log.error({ e }, "[FEEDBACK] failed to open done thread");
              }
            }

            // ✅ Atualiza o modal (lista)
            const view = payload.view;
            if (view?.id) {
              const filters = getFeedbackFiltersFromView(view);
              const items = await fetchFeedbackList(filters);
              const myOpenItems = userSlackId
                ? await fetchMyOpenFeedback({ createdBySlackId: userSlackId, take: 10 })
                : [];

              await slack.views.update({
                view_id: view.id,
                hash: view.hash,
                view: feedbackAdminModalView({
                  items,
                  typeFilter: filters.typeFilter,
                  statusFilter: filters.statusFilter,
                  myOpenItems,
                  canEdit: isFeedbackAdmin(userSlackId),
                }),
              });
            }

            // ✅ AGORA SIM: Atualiza a HOME (criador + admin + admins)
            const affected = new Set<string>();
            affected.add(existing.createdBySlackId);
            if (userSlackId) affected.add(userSlackId);

            // opcional, mas recomendado: atualiza home de todos admins também
            for (const a of getFeedbackAdminIds()) affected.add(a);

            const results = await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));

            // loga se algum publish falhar (pra você ver o motivo)
            const failed = results
              .map((r, i) => ({ r, uid: Array.from(affected)[i] }))
              .filter((x) => x.r.status === "rejected");

            if (failed.length) {
              req.log.error(
                { failed: failed.map((f) => ({ uid: f.uid, reason: (f.r as PromiseRejectedResult).reason })) },
                "[FEEDBACK] publishHome failed for some users"
              );
            }
          })().catch((e) => {
            req.log.error({ e }, "[FEEDBACK] status update failed");
          });

          return;
        }

        // ---- Topo (Home Header)
        if (actionId === HOME_CREATE_TASK_ACTION_ID) {
          const projects =
            userSlackId
              ? await prisma.project.findMany({
                where: {
                  status: "active",
                  OR: [
                    // ✅ criador sempre vê
                    { createdBySlackId: userSlackId },

                    // ✅ só vê se já existe alguma task do projeto envolvendo a pessoa
                    {
                      tasks: {
                        some: {
                          OR: [
                            { delegation: userSlackId },
                            { responsible: userSlackId },
                            { carbonCopies: { some: { slackUserId: userSlackId } } },
                          ],
                        },
                      },
                    },
                  ],
                },
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
          if (!userSlackId) return reply.status(200).send();

          const appUrl = String(process.env.APP_URL ?? "").replace(/\/$/, "");
          const templateUrl = appUrl ? `${appUrl}/public/templates/tasks_import_template.xlsx` : "";

          await sendBotDm(
            slack,
            userSlackId,
            "📦 *Importar atividades em lote*\n\n" +
            "Envie um arquivo *.xlsx* aqui no DM comigo.\n" +
            (templateUrl ? `Clique <${templateUrl}|aqui> para baixar o template.\n\n` : "\n")
          );

          return reply.status(200).send();
        }

        // dentro do block_actions
        if (actionId === "SEU_ACTION_ID_IMPORT_EXCEL") {
          if (!userSlackId) return reply.status(200).send();

          reply.status(200).send(); // ACK rápido

          void sendImportTemplateDm(slack, userSlackId).catch((e) => {
            req.log.error({ e }, "[IMPORT_EXCEL] send template DM failed");
          });

          return;
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
              OR: [{ responsible: userSlackId }, { delegation: userSlackId }],
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
              OR: [{ responsible: userSlackId }, { delegation: userSlackId }],
            },
            data: { status: "done" },
          });

          // ✅ remove da agenda (status done => sync apaga)
          void Promise.allSettled(concludedIds.map((id) => syncCalendarEventForTask(id))).catch(() => { });

          // ✅ recorrência: cria a próxima e (AGORA) vamos notificar a criação
          const nextResults = await Promise.allSettled(
            concludedIds.map((id) => createNextRecurringTaskFromCompleted({ completedTaskId: id }))
          );

          const nextCreated = nextResults
            .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
            .map((r) => r.value)
            .filter(Boolean) as Array<{
              id: string;
              title: string;
              term: Date | null;
              deadlineTime: string | null;
              responsible: string;
              delegation: string | null;
              carbonCopiesSlackIds: string[];
            }>;


          // ✅ (opcional e recomendado) não notificar se a nova task estiver bloqueada por dependsOn ainda não done
          let nextIdsAllowedToNotify = new Set<string>();
          if (nextCreated.length) {
            const meta = await prisma.task.findMany({
              where: { id: { in: nextCreated.map((n) => n.id) } },
              select: {
                id: true,
                dependsOnId: true,
                dependsOn: { select: { status: true } },
                slackOpenMessageTs: true,
              },
            });

            for (const m of meta) {
              const unlocked = !m.dependsOnId || m.dependsOn?.status === "done";
              const notYetNotified = !m.slackOpenMessageTs;
              if (unlocked && notYetNotified) nextIdsAllowedToNotify.add(m.id);
            }
          }

          // ✅ envia a "mensagem de criação" para a nova recorrente (todas as recorrências)
          if (nextCreated.length) {
            await Promise.allSettled(
              nextCreated
                .filter((n) => nextIdsAllowedToNotify.has(n.id))
                .map((n) =>
                  notifyTaskCreated({
                    slack,
                    taskId: n.id,
                    createdBy: n.delegation ?? n.responsible,
                    taskTitle: n.title,
                    responsible: n.responsible,
                    carbonCopies: n.carbonCopiesSlackIds ?? [],
                    term: n.term,
                    deadlineTime: n.deadlineTime ?? null,
                  })
                )
            );
          }

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
                createdBy: (t.delegation as any) ?? t.responsible,
                taskTitle: t.title,
                responsible: t.responsible,
                carbonCopies: t.carbonCopies.map((c) => c.slackUserId),
                term: t.term,
                deadlineTime: (t as any).deadlineTime ?? null,
              })
            )
          );

          // ✅ Home updates: inclui quem clicou + envolvidos das tasks concluídas + dependentes + novas recorrentes
          const affected = new Set<string>();
          affected.add(userSlackId);

          for (const t of tasksToConclude) {
            affected.add(t.responsible);
            if (t.delegation) affected.add(t.delegation);
            for (const c of t.carbonCopies) affected.add(c.slackUserId);
          }

          for (const d of dependents) {
            affected.add(d.responsible);
            if (d.delegation) affected.add(d.delegation);
            for (const c of d.carbonCopies) affected.add(c.slackUserId);
          }

          // ✅ inclui envolvidos nas novas recorrentes (pra aparecer na Home de quem recebeu)
          for (const n of nextCreated) {
            affected.add(n.responsible);
            if (n.delegation) affected.add(n.delegation);
            for (const cc of n.carbonCopiesSlackIds ?? []) affected.add(cc);
          }

          await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));

          return reply.status(200).send();
        }


        // ---- Refresh
        if (actionId === TASKS_REFRESH_ACTION_ID) {
          if (userSlackId) await publishHome(slack, userSlackId);
          return reply.status(200).send();
        }

        // ---- Enviar Thread
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

            // ✅ 1) Notifica o grupo (DMs)
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

            // ✅ 2) Substitui a mensagem principal (DM de criação) por "cancelada"
            await Promise.allSettled(
              tasksToDelete.map((t) =>
                markTaskOpenMessageAsCanceled({
                  slack,
                  taskId: t.id,
                  taskTitle: t.title,
                  canceledBySlackId: userSlackId,
                })
              )
            );

            // ✅ 3) Remove da agenda antes de deletar
            await Promise.allSettled(tasksToDelete.map((t) => deleteCalendarEventForTask(t.id)));

            // ✅ 4) Deleta do banco
            await prisma.task.deleteMany({
              where: {
                id: { in: tasksToDelete.map((t) => t.id) },
                delegation: userSlackId,
              },
            });

            // ✅ 5) Atualiza Home de todos afetados
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
              urgency: true, // ✅ NOVO
              calendarPrivate: true, // ✅ NOVO
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
              urgency: (task as any).urgency ?? "light", // ✅ NOVO
              calendarPrivate: Boolean((task as any).calendarPrivate ?? false), // ✅ NOVO
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
              taskId: task.id, // ✅ NOVO
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

        if (actionId === BATCH_ADD_TASK_ACTION_ID || actionId === BATCH_REMOVE_TASK_ACTION_ID) {
          if (!userSlackId) return reply.status(200).send();

          const view = payload.view;
          if (!view?.id) return reply.status(200).send();

          let count = 1;
          try {
            const meta = JSON.parse(view.private_metadata ?? "{}");
            count = Number(meta.count ?? 1) || 1;
          } catch { }

          if (actionId === BATCH_ADD_TASK_ACTION_ID) count += 1;
          if (actionId === BATCH_REMOVE_TASK_ACTION_ID) count -= 1;

          // refaz options de projetos (pra manter seleção válida)
          const projects = await prisma.project.findMany({
            where: {
              status: "active",
              OR: [
                { createdBySlackId: userSlackId },
                {
                  tasks: {
                    some: {
                      OR: [
                        { delegation: userSlackId },
                        { responsible: userSlackId },
                        { carbonCopies: { some: { slackUserId: userSlackId } } },
                      ],
                    },
                  },
                },
              ],
            },
            orderBy: { name: "asc" },
            take: 100,
            select: { id: true, name: true },
          });


          await slack.views.update({
            view_id: view.id,
            hash: view.hash,
            view: sendBatchModalView({ projects, count }),
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
        // FEEDBACK CREATE (Bug/Sugestão) ✅
        // - status nasce como "pending"
        // -------------------------
        if (cb === FEEDBACK_CREATE_CALLBACK_ID) {
          if (!userSlackId) return reply.send({});

          const values = payload.view.state.values;

          const type = getSelectedOptionValue(values, FEEDBACK_TYPE_BLOCK_ID, FEEDBACK_TYPE_SELECT_ACTION_ID);
          const title = (getInputValue(values, FEEDBACK_TITLE_BLOCK_ID, FEEDBACK_TITLE_INPUT_ACTION_ID) ?? "").trim();
          const description = (getInputValue(values, FEEDBACK_DESC_BLOCK_ID, FEEDBACK_DESC_INPUT_ACTION_ID) ?? "").trim();

          const errors: Record<string, string> = {};
          if (!type) errors[FEEDBACK_TYPE_BLOCK_ID] = "Selecione o tipo.";
          if (!title) errors[FEEDBACK_TITLE_BLOCK_ID] = "Informe o título.";
          if (!description) errors[FEEDBACK_DESC_BLOCK_ID] = "Descreva o problema/sugestão.";

          if (Object.keys(errors).length) {
            return reply.send({ response_action: "errors", errors });
          }

          const created = await prisma.feedback.create({
            data: {
              type: type as any,
              title,
              description,
              status: "pending",
              createdBySlackId: userSlackId,
            },
            select: { id: true, type: true, title: true },
          });

          // ACK
          reply.send({});

          void (async () => {
            const label = created.type === "bug" ? "Bug" : "Sugestão";

            await sendBotDm(
              slack,
              userSlackId,
              `✅ ${label} registrada como *Pendente*.\n• *${created.title}*\nUID: \`${created.id}\`\n\nAcompanhe em *Ver bugs/sugestões*.`
            );

            const admins = getFeedbackAdminIds();
            if (admins.length) {
              await Promise.allSettled(
                admins.map((adminId) =>
                  sendBotDm(
                    slack,
                    adminId,
                    `🆕 Novo ${label} (Pendente) enviado por <@${userSlackId}>:\n• *${created.title}*\nUID: \`${created.id}\``
                  )
                )
              );
            }
          })().catch((e) => {
            req.log.error({ e }, "[FEEDBACK] create side-effects failed");
          });

          return;
        }


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

          // ✅ checkbox "Deixar evento privado"
          const calendarPrivate =
            (values?.[TASK_CAL_PRIVATE_BLOCK_ID]?.[TASK_CAL_PRIVATE_ACTION_ID]?.selected_options ?? []).some(
              (o: any) => String(o?.value ?? "") === "private"
            );

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
            calendarPrivate, // ✅ NOVO
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

            // ✅ se depende de outra task ainda não done, adia DM de "task criada"
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
              req.log.info(
                { taskId: task.id, dependsOnId },
                "[CREATE_TASK] notifyTaskCreated deferred (blocked by dependency)"
              );
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

          // ✅ NOVO: urgência no edit
          const urgency = getSelectedOptionValue(values, EDIT_URGENCY_BLOCK_ID, EDIT_URGENCY_ACTION_ID) ?? "light";

          // ✅ NOVO: privado no edit
          const calendarPrivate = isCheckboxChecked(
            values,
            EDIT_CAL_PRIVATE_BLOCK_ID,
            EDIT_CAL_PRIVATE_ACTION_ID,
            "private"
          );

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

          if (!urgency || !["light", "asap", "turbo"].includes(String(urgency))) {
            return reply.send({
              response_action: "errors",
              errors: { [EDIT_URGENCY_BLOCK_ID]: "Selecione a urgência." },
            });
          }

          let taskId = "";
          try {
            const meta = JSON.parse(payload.view.private_metadata ?? "{}");
            taskId = String(meta.taskId ?? "");
          } catch { }

          if (!taskId) return reply.send({});

          // 1) atualiza no banco primeiro
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
            urgency, // ✅ NOVO
            calendarPrivate, // ✅ NOVO
          });

          // ✅ ACK rápido pro Slack
          reply.send({});

          // 2) efeitos colaterais async (email/calendar/notifs/home + update da msg principal)
          void (async () => {
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

            // ✅ se mudou responsável: reatribui a mensagem principal (avisa o antigo + cria pro novo)
            // ✅ se NÃO mudou: apenas atualiza a mensagem principal existente (prazo/título/etc)
            try {
              const beforeResp = (updated as any)?.before?.responsible ?? null;
              const afterResp = (updated as any)?.after?.responsible ?? null;

              if (beforeResp && afterResp && beforeResp !== afterResp) {
                await handleTaskResponsibleReassign({
                  slack,
                  taskId,
                  editedBySlackId: userSlackId,
                });
              } else {
                await updateTaskOpenMessage(slack, taskId);
              }
            } catch (e) {
              req.log.error({ e, taskId }, "[EDIT_TASK] open message reassign/update failed");
            }

            const allCc = Array.from(new Set([...(updated.before.carbonCopies ?? []), ...(updated.after.carbonCopies ?? [])]));

            // (mantive seu pattern de before/after)
            const u: any = updated as any;
            const before = u.before ?? {};
            const after = u.after ?? {};

            await Promise.allSettled([
              notifyTaskEdited({
                slack,
                taskId,
                editedBy: userSlackId,
                responsible: after.responsible,
                carbonCopies: allCc,

                oldTitle: before.title ?? null,
                newTitle: after.title ?? null,

                oldTerm: before.term ?? null,
                newTerm: after.term ?? null,

                oldDeadlineTime: before.deadlineTime ?? null,
                newDeadlineTime: after.deadlineTime ?? null,

                oldResponsible: before.responsible ?? null,
                newResponsible: after.responsible ?? null,

                oldRecurrence: before.recurrence ?? null,
                newRecurrence: after.recurrence ?? null,

                oldUrgency: before.urgency ?? null, // ✅ NOVO
                newUrgency: after.urgency ?? null, // ✅ NOVO

                oldCalendarPrivate: before.calendarPrivate ?? null, // ✅ NOVO
                newCalendarPrivate: after.calendarPrivate ?? null, // ✅ NOVO

                oldCarbonCopies: before.carbonCopies ?? null,
                newCarbonCopies: after.carbonCopies ?? null,
              }),
            ]);

            const affectedUsers = new Set<string>();
            affectedUsers.add(userSlackId);
            affectedUsers.add(updated.after.responsible);
            if (updated.after.delegation) affectedUsers.add(updated.after.delegation);
            for (const cc of allCc) affectedUsers.add(cc);

            await Promise.allSettled(Array.from(affectedUsers).map((uid) => publishHome(slack, uid)));
          })().catch((err) => {
            req.log.error({ err, taskId }, "[EDIT_TASK] side-effects failed");
          });

          return;
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

          // ✅ NOVO: captura prazo antigo (pra notificar corretamente na thread)
          const before = await prisma.task.findUnique({
            where: { id: taskId },
            select: { term: true },
          });
          const fromIso = before?.term ? before.term.toISOString().slice(0, 10) : null;

          await rescheduleTaskService({
            taskId,
            requesterSlackId: userSlackId,
            newDateIso,
            newTime,
          });

          // ✅ ACK rápido pro Slack
          reply.send({});

          void (async () => {
            // ✅ sincroniza agenda (mudou data/horário)
            try {
              await syncCalendarEventForTask(taskId);
            } catch (e) {
              req.log.error({ e, taskId }, "[RESCHEDULE] calendar sync failed");
            }

            // ✅ atualiza a mensagem principal (DM de abertura) com o novo prazo
            try {
              await updateTaskOpenMessage(slack, taskId);
            } catch (e) {
              req.log.error({ e, taskId }, "[RESCHEDULE] updateTaskOpenMessage failed");
            }

            const after = await prisma.task.findUnique({
              where: { id: taskId },
              select: {
                id: true,
                title: true,
                responsible: true,
                delegation: true,
                slackOpenChannelId: true,     // ✅ NOVO
                slackOpenMessageTs: true,     // ✅ NOVO
                carbonCopies: { select: { slackUserId: true } },
              },
            });

            if (after) {
              const br = formatDateBRFromIso(newDateIso);
              const newDateBr = newTime?.trim() ? `${br} às ${newTime.trim()}` : br;

              // ✅ 1) mantém DM para envolvidos (como já está)
              const dmPromise = notifyTaskRescheduledGroup({
                slack,
                responsibleSlackId: after.responsible,
                delegationSlackId: after.delegation ?? null,
                carbonCopiesSlackIds: after.carbonCopies.map((c) => c.slackUserId),
                taskTitle: after.title,
                newDateBr,
              });

              // ✅ 2) NOVO: manda mensagem na thread da mensagem principal (criação)
              const threadPromise = (async () => {
                if (!after.slackOpenChannelId || !after.slackOpenMessageTs) return;

                const oldBr = fromIso ? formatDateBRFromIso(fromIso) : null;
                const text =
                  oldBr
                    ? `📅 Prazo reprogramado por <@${userSlackId}>: *${after.title}* de *${oldBr}* para *${newDateBr}*.`
                    : `📅 Prazo reprogramado por <@${userSlackId}>: *${after.title}* para *${newDateBr}*.`;

                await slack.chat.postMessage({
                  channel: after.slackOpenChannelId,
                  thread_ts: after.slackOpenMessageTs,
                  text,
                });
              })();

              await Promise.allSettled([
                dmPromise,
                threadPromise,

                publishHome(slack, after.responsible),
                ...(after.delegation ? [publishHome(slack, after.delegation)] : []),
                ...Array.from(new Set(after.carbonCopies.map((c) => c.slackUserId))).map((uid) => publishHome(slack, uid)),
              ]);
            } else {
              await publishHome(slack, userSlackId);
            }
          })().catch((err) => {
            req.log.error({ err, taskId }, "[RESCHEDULE] side-effects failed");
          });

          return;
        }


        // -------------------------
        // SEND BATCH (placeholder)
        // -------------------------
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          if (!userSlackId) return reply.send({});

          const values = payload.view?.state?.values ?? {};

          let count = 1;
          try {
            const meta = JSON.parse(payload.view.private_metadata ?? "{}");
            count = Number(meta.count ?? 1) || 1;
          } catch { }

          const errors: Record<string, string> = {};
          const tasksInput: Array<{
            title: string;
            description?: string | null;
            responsible: string;
            termIso: string | null;
            deadlineTime: string | null;
            projectId: string | null;
            dependsOnId: string | null;
            recurrence: string | null;
            urgency: string;
            carbonCopies: string[];
          }> = [];

          function bid(i: number) {
            return {
              titleBlock: `batch_title_block_${i}`,
              descBlock: `batch_desc_block_${i}`,
              respBlock: `batch_resp_block_${i}`,
              dueBlock: `batch_due_block_${i}`,
              timeBlock: `batch_time_block_${i}`,
              urgencyBlock: `batch_urgency_block_${i}`,
              ccBlock: `batch_cc_block_${i}`,
              projectBlock: `batch_project_block_${i}`,
              recurrenceBlock: `batch_recurrence_block_${i}`,
              dependsBlock: `batch_depends_block_${i}`,
            };
          }

          for (let i = 0; i < count; i++) {
            const ids = bid(i);

            const title = (getInputValue(values, ids.titleBlock, "title") ?? "").trim();
            const description = (getInputValue(values, ids.descBlock, "description") ?? "").trim() || null;

            const responsible = getSelectedUser(values, ids.respBlock, "responsible") ?? "";

            const termIso = getSelectedDate(values, ids.dueBlock, "due_date") ?? null;
            const deadlineTime = getSelectedTime(values, ids.timeBlock, TASK_TIME_ACTION_ID) ?? null;

            const projectId = getSelectedOptionValue(values, ids.projectBlock, TASK_PROJECT_ACTION_ID) ?? null;
            const dependsOnId = getSelectedOptionValue(values, ids.dependsBlock, TASK_DEPENDS_ACTION_ID) ?? null;

            const recurrenceRaw = getSelectedOptionValue(values, ids.recurrenceBlock, TASK_RECURRENCE_ACTION_ID) ?? "none";
            const recurrence = recurrenceRaw === "none" ? null : recurrenceRaw;

            const urgency = getSelectedOptionValue(values, ids.urgencyBlock, "urgency") ?? "light";
            const carbonCopies = getSelectedUsers(values, ids.ccBlock, "carbon_copies");

            // validações mínimas (igual create task)
            if (!title) errors[ids.titleBlock] = "Informe o título.";
            if (!responsible) errors[ids.respBlock] = "Selecione o responsável.";

            tasksInput.push({
              title,
              description,
              responsible,
              termIso,
              deadlineTime,
              projectId,
              dependsOnId,
              recurrence,
              urgency,
              carbonCopies,
            });
          }

          if (Object.keys(errors).length) {
            return reply.send({ response_action: "errors", errors });
          }

          // cria antes de fechar modal (como você faz no createTask)
          const createdTasks = [];
          for (const t of tasksInput) {
            const termDate: Date | null = t.termIso ? new Date(`${t.termIso}T03:00:00.000Z`) : null;

            const task = await createTaskService({
              title: t.title,
              description: t.description?.trim() ? t.description : undefined,
              delegation: userSlackId,
              responsible: t.responsible,
              term: termDate,
              deadlineTime: t.deadlineTime ?? null,
              recurrence: t.recurrence ?? null,
              projectId: t.projectId ?? null,
              dependsOnId: t.dependsOnId ?? null,
              urgency: t.urgency,
              carbonCopies: t.carbonCopies,
            });

            createdTasks.push(task);
          }

          // fecha modal
          reply.send({});

          // side-effects async
          void (async () => {
            const affected = new Set<string>();
            affected.add(userSlackId);

            for (const task of createdTasks) {
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
                req.log.error({ e, taskId: task.id }, "[BATCH_CREATE] email/calendar sync failed");
              }

              // depende?
              let deferNotifyCreated = false;
              if (task.dependsOnId) {
                const dep = await prisma.task.findUnique({
                  where: { id: task.dependsOnId },
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
              }

              affected.add(task.responsible);
              if (task.delegation) affected.add(task.delegation);
              for (const c of task.carbonCopies) affected.add(c.slackUserId);
            }

            await Promise.allSettled(Array.from(affected).map((uid) => publishHome(slack, uid)));

            // opcional: DM de resumo pro criador
            await sendBotDm(slack, userSlackId, `✅ ${createdTasks.length} tarefas criadas em lote.`);
          })().catch((err) => {
            req.log.error({ err }, "[BATCH_CREATE] side-effects failed");
          });

          return;
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

          await Promise.allSettled(Array.from(new Set([...(memberIds ?? []), userSlackId])).map((id) => publishHome(slack, id)));

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
