import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { WebClient } from "@slack/web-api";
import {
  homeHeaderActionsBlocks,
  HOME_CREATE_TASK_ACTION_ID,
  HOME_SEND_BATCH_ACTION_ID,
  HOME_NEW_PROJECT_ACTION_ID,
} from "../views/homeHeaderActions";
import { createTaskModalView, CREATE_TASK_MODAL_CALLBACK_ID } from "../views/createTaskModal";
import { sendBatchModalView, SEND_BATCH_MODAL_CALLBACK_ID } from "../views/sendBatchModal";
import { createProjectModalView, CREATE_PROJECT_MODAL_CALLBACK_ID } from "../views/createProjectModal";

import { TASK_TOGGLE_ACTION_ID } from "../views/homeTasksBlocks";
import type { HomeTaskItem, Urgency } from "../views/homeTasksBlocks";

import { createTaskService } from "../services/createTaskService";
import { prisma } from "../lib/prisma"; // ajuste se seu prisma estiver em outro path
import { homeView } from "../views/homeView";

// ========= helpers (mesmos do events) =========
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function normalizeUrgency(u: unknown): Urgency {
  if (u === "light" || u === "asap" || u === "turbo") return u;
  return "light";
}
function toHomeTaskItem(t: {
  id: string;
  title: string;
  description: string | null;
  delegation: string;
  term: Date | null;
  urgency: unknown;
}): HomeTaskItem {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    term: t.term,
    urgency: normalizeUrgency(t.urgency),
  };
}

async function publishHomeForUser(slack: WebClient, userId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStart = startOfDay(tomorrow);
  const tomorrowEnd = endOfDay(tomorrow);

  const rawTasks = await prisma.task.findMany({
    where: { responsible: userId },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      urgency: true,
      delegation: true,
    },
  });

  const tasks = rawTasks.map(toHomeTaskItem);

  const tasksToday = tasks.filter(
    (t) => t.term && new Date(t.term) >= todayStart && new Date(t.term) <= todayEnd
  );

  const tasksTomorrow = tasks.filter(
    (t) => t.term && new Date(t.term) >= tomorrowStart && new Date(t.term) <= tomorrowEnd
  );

  const tasksFuture = tasks.filter((t) => t.term && new Date(t.term) > tomorrowEnd);

  await slack.views.publish({
    user_id: userId,
    view: homeView({
      // se sua homeView também incluir os botões, ok.
      // se não, ela pode fazer: blocks: [...homeHeaderActionsBlocks(), ...homeTasksBlocks(...)]
      tasksToday,
      tasksTomorrow,
      tasksFuture,
    }),
  });
}

// ========= route =========
export async function interactive(app: FastifyInstance, slack: WebClient) {
  app.register(formbody);

  app.post("/interactive", async (req, reply) => {
    try {
      const body = req.body as any;
      const payload = JSON.parse(body.payload);

      // =========================
      // 1) CLIQUES (Home / checkboxes / buttons)
      // =========================
      if (payload.type === "block_actions") {
        const action = payload.actions?.[0];
        const actionId = action?.action_id as string | undefined;

        // ✅ Checkbox "Concluir"
        if (actionId === TASK_TOGGLE_ACTION_ID) {
          const taskId = action?.selected_options?.[0]?.value as string | undefined;
          const userId = payload.user?.id as string;

          if (taskId) {
            // "Concluir" => deletar (ou trocar para update se quiser status)
            await prisma.task.delete({ where: { id: taskId } });

            // republish home pra atualizar lista
            await publishHomeForUser(slack, userId);
          }

          return reply.status(200).send(); // ACK
        }

        // ✅ Botões do topo da Home
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

        return reply.status(200).send(); // ACK padrão
      }

      // =========================
      // 2) SUBMIT MODAIS
      // =========================
      if (payload.type === "view_submission") {
        const cb = payload.view?.callback_id as string | undefined;

        // ---- Criar Task ----
        if (cb === CREATE_TASK_MODAL_CALLBACK_ID) {
          const values = payload.view.state.values;

          const title = values.title_block.title.value as string;
          const description = values.desc_block?.description?.value as string | undefined;

          const responsible = values.resp_block.responsible.selected_user as string;

          // datepicker retorna YYYY-MM-DD
          const dueDate = values.due_block?.due_date?.selected_date as string | undefined;

          const urgency = values.urgency_block.urgency.selected_option.value as string;

          const carbonCopies =
            (values.cc_block?.carbon_copies?.selected_users as string[] | undefined) ?? [];

          // salva no banco
          await createTaskService({
            title,
            description,
            delegation: payload.user.id, // quem criou
            responsible,
            term: dueDate ?? null,
            urgency,
            recurrence: "none",
            carbonCopies,
          });

          // fecha modal
          // (Opcional) republish home para refletir a nova task imediatamente
          await publishHomeForUser(slack, payload.user.id);

          return reply.send({});
        }

        // ---- Lote ----
        if (cb === SEND_BATCH_MODAL_CALLBACK_ID) {
          // TODO implementar
          return reply.send({});
        }

        // ---- Projeto ----
        if (cb === CREATE_PROJECT_MODAL_CALLBACK_ID) {
          // TODO implementar
          return reply.send({});
        }

        return reply.send({});
      }

      return reply.status(200).send();
    } catch (err) {
      req.log.error(err);
      return reply.status(200).send(); // ACK mesmo assim
    }
  });
}
