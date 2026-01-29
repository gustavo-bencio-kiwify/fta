// src/services/publishHome.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

import { homeTasksBlocks } from "../views/homeTasksBlocks";
import { homeHeaderActionsBlocks } from "../views/homeHeaderActions";

import { rolloverOverdueTasksForResponsible } from "./rolloverOverdueTasks";
import { notifyTasksReplanned } from "./notifyTaskReplanned";

const SAO_PAULO_TZ = "America/Sao_Paulo";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getSaoPauloTodayIso(now = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));

  return `${year}-${pad2(month)}-${pad2(day)}`; // YYYY-MM-DD
}

function addDaysIso(iso: string, days: number) {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function termIso(term: Date | null) {
  if (!term || Number.isNaN(term.getTime())) return null;
  return term.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function bucketByIso(taskTerm: Date | null, todayIso: string) {
  const tIso = termIso(taskTerm);
  if (!tIso) return "future";

  const tomorrowIso = addDaysIso(todayIso, 1);
  const dayAfterIso = addDaysIso(todayIso, 2);

  if (tIso < todayIso) return "overdue";
  if (tIso === todayIso) return "today";
  if (tIso === tomorrowIso) return "tomorrow";
  if (tIso >= dayAfterIso) return "future";
  return "future";
}

type RawTask = {
  id: string;
  title: string;
  description: string | null;
  delegation: string | null;
  responsible: string;
  term: Date | null;
  urgency: "light" | "asap" | "turbo";
  recurrence: string | null;
  status: string;
};

export async function publishHome(slack: WebClient, userId: string) {
  // ✅ padroniza: dentro desse arquivo a gente usa SEMPRE userSlackId
  const userSlackId = userId;

  // =========================================================
  // 0) ROLLOVER (após 20h GMT-3) + NOTIFICAÇÃO (DM do bot)
  // =========================================================
  try {
    const result = await rolloverOverdueTasksForResponsible(userSlackId);

    // ✅ Só notifica quando realmente houve alteração
    if (result.ran && result.moved?.length) {
      await notifyTasksReplanned({
        slack,
        responsibleSlackId: userSlackId,
        items: result.moved,
      });
    }
  } catch (e) {
    // não quebra a Home por causa do rollover/notificação
    console.error("[publishHome] rollover/notify replanned failed:", e);
  }

  const now = new Date();
  const todayIso = getSaoPauloTodayIso(now);

  // usado para contagem de atrasadas por projeto (term < hoje)
  const todayUtc = new Date(`${todayIso}T00:00:00.000Z`);

  // ============================
  // 1) TAREFAS (você é responsável)
  // ============================
  const myTasks = (await prisma.task.findMany({
    where: { responsible: userSlackId, status: { not: "done" } },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      delegation: true,
      responsible: true,
      term: true,
      urgency: true,
      recurrence: true,
      status: true,
    },
  })) as unknown as RawTask[];

  const tasksOverdue = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "overdue")
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksToday = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "today")
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksTomorrow = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "tomorrow")
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksFuture = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "future")
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      term: t.term,
      urgency: t.urgency,
    }));

  // ============================
  // 2) TAREFAS (você delegou)
  // ============================
  const delegated = (await prisma.task.findMany({
    where: { delegation: userSlackId, status: { not: "done" } },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      term: true,
      urgency: true,
      responsible: true,
    },
    take: 40,
  })) as unknown as Array<{
    id: string;
    title: string;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
  }>;

  const delegatedToday = delegated.filter((t) => bucketByIso(t.term, todayIso) === "today");
  const delegatedTomorrow = delegated.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow");
  const delegatedFuture = delegated.filter(
    (t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue"
  );

  // ============================
  // 3) TAREFAS (você está em cópia)
  // ============================
  const ccTasks = (await prisma.task.findMany({
    where: {
      status: { not: "done" },
      carbonCopies: { some: { slackUserId: userSlackId } },
    },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      term: true,
      urgency: true,
      responsible: true,
      delegation: true,
    },
    take: 40,
  })) as unknown as Array<{
    id: string;
    title: string;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
    delegation: string | null;
  }>;

  const ccToday = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "today");
  const ccTomorrow = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow");
  const ccFuture = ccTasks.filter(
    (t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue"
  );

  // ============================
  // 4) RECORRÊNCIAS
  // ============================
  const recurrenceTasks = (await prisma.task.findMany({
    where: {
      responsible: userSlackId,
      status: { not: "done" },
      recurrence: { not: null },
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, title: true, recurrence: true },
    take: 15,
  })) as unknown as Array<{ id: string; title: string; recurrence: string }>;

  // ============================
  // 5) PROJETOS QUE PARTICIPO
  // ============================
  const projects = await prisma.project.findMany({
    where: {
      status: "active", // ✅ mantém a feature nova
      members: { some: { slackUserId: userSlackId } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const projectsWithCounts = await Promise.all(
    projects.map(async (p) => {
      const [openCount, doneCount, overdueCount] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id, status: { not: "done" } } }),
        prisma.task.count({ where: { projectId: p.id, status: "done" } }),
        prisma.task.count({
          where: { projectId: p.id, status: { not: "done" }, term: { lt: todayUtc } },
        }),
      ]);

      return { id: p.id, name: p.name, openCount, doneCount, overdueCount };
    })
  );

  // ============================
  // 6) MONTA + PUBLICA HOME
  // ============================
  const blocks = homeHeaderActionsBlocks().concat(
    homeTasksBlocks({
      tasksOverdue,
      tasksToday,
      tasksTomorrow,
      tasksFuture,

      delegatedToday: delegatedToday.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
      })),
      delegatedTomorrow: delegatedTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
      })),
      delegatedFuture: delegatedFuture.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
      })),

      ccToday: ccToday.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        delegation: t.delegation,
      })),
      ccTomorrow: ccTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        delegation: t.delegation,
      })),
      ccFuture: ccFuture.map((t) => ({
        id: t.id,
        title: t.title,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        delegation: t.delegation,
      })),

      recurrences: recurrenceTasks.map((r) => ({
        id: r.id,
        title: r.title,
        recurrence: r.recurrence,
      })),

      projects: projectsWithCounts,
    })
  );

  await slack.views.publish({
    user_id: userSlackId,
    view: { type: "home", blocks },
  });
}
