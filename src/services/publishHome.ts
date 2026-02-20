// src/services/publishHome.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

import { homeTasksBlocks } from "../views/homeTasksBlocks";
import { homeHeaderActionsBlocks } from "../views/homeHeaderActions";

import type { Prisma } from "../generated/prisma/browser";

const SAO_PAULO_TZ = "America/Sao_Paulo";

// ✅ ajuda a evitar Slack cortar o final (projetos some quando excede blocks)
const MAX_TASKS_PER_SECTION = 8;

// =========================================================
// ✅ Slack ID -> Nome (cache)
// - precisa do scope: users:read
// - dentro do checkbox é plain_text, então não existe mention real.
//   Aqui a gente transforma Uxxxx -> "Larissa Bittar" e mostra "@Larissa Bittar".
// =========================================================
const slackNameCache = new Map<string, string>();

async function getSlackDisplayName(slack: WebClient, userId: string): Promise<string> {
  if (!userId) return "";
  if (slackNameCache.has(userId)) return slackNameCache.get(userId)!;

  try {
    const res = await slack.users.info({ user: userId });
    const u: any = (res as any)?.user;

    const name =
      (u?.profile?.display_name as string) ||
      (u?.profile?.real_name as string) ||
      (u?.real_name as string) ||
      (u?.name as string) ||
      userId;

    const finalName = String(name).trim() || userId;
    slackNameCache.set(userId, finalName);
    return finalName;
  } catch {
    // se faltar scope ou erro, cai pro próprio id (mas pelo menos não quebra)
    slackNameCache.set(userId, userId);
    return userId;
  }
}

async function resolveSlackNames(slack: WebClient, ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set((ids ?? []).filter(Boolean).map(String)));
  const map = new Map<string, string>();

  await Promise.all(
    unique.map(async (id) => {
      map.set(id, await getSlackDisplayName(slack, id));
    })
  );

  return map;
}

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
  delegation: string; // no seu schema é obrigatório
  responsible: string;
  term: Date | null;
  urgency: "light" | "asap" | "turbo";
  recurrence: string | null;
  status: string;
};

export async function publishHome(slack: WebClient, userId: string) {
  const userSlackId = userId;

  // =========================================================
  // 1) Datas base
  // =========================================================
  const now = new Date();
  const todayIso = getSaoPauloTodayIso(now);
  const todayUtc = new Date(`${todayIso}T00:00:00.000Z`);

  // ✅ regra de visibilidade: só aparece se não depende de ninguém OU se o "pai" já está done
  const visibleWhere: Prisma.TaskWhereInput = {
    OR: [{ dependsOnId: null }, { dependsOn: { status: "done" } }],
  };

  // ✅ Regra pedida:
  // Se delegador == responsável (mesmo usuário), NÃO aparece em "Minhas tarefas"
  // e aparece só em "Você delegou".
  const excludeSelfDelegatedFromResponsible: Prisma.TaskWhereInput = {
    delegation: { not: userSlackId },
  };

  // =========================================================
  // 2) Minhas tarefas (responsible)
  // =========================================================
  const myTasks = (await prisma.task.findMany({
    where: {
      responsible: userSlackId,
      status: { not: "done" },
      AND: [visibleWhere, excludeSelfDelegatedFromResponsible],
    },
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

  // ✅ resolve nomes para delegation (delegado por ...)
  const myDelegationNameMap = await resolveSlackNames(
    slack,
    myTasks.map((t) => t.delegation)
  );

  const tasksOverdue = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "overdue")
    .slice(0, MAX_TASKS_PER_SECTION)
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      delegationName: myDelegationNameMap.get(t.delegation) ?? null, // ✅
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksToday = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "today")
    .slice(0, MAX_TASKS_PER_SECTION)
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      delegationName: myDelegationNameMap.get(t.delegation) ?? null, // ✅
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksTomorrow = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "tomorrow")
    .slice(0, MAX_TASKS_PER_SECTION)
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      delegationName: myDelegationNameMap.get(t.delegation) ?? null, // ✅
      term: t.term,
      urgency: t.urgency,
    }));

  const tasksFuture = myTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "future")
    .slice(0, MAX_TASKS_PER_SECTION)
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      delegation: t.delegation,
      delegationName: myDelegationNameMap.get(t.delegation) ?? null, // ✅
      term: t.term,
      urgency: t.urgency,
    }));

  // =========================================================
  // 3) Delegadas por mim (delegation)
  // =========================================================
  const delegated = (await prisma.task.findMany({
    where: {
      delegation: userSlackId,
      status: { not: "done" },
      AND: [visibleWhere],
    },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    // ✅ agora puxa description também
    select: { id: true, title: true, description: true, term: true, urgency: true, responsible: true },
    take: 60,
  })) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
  }>;

  // ✅ resolve nomes do responsável
  const delegatedResponsibleNameMap = await resolveSlackNames(
    slack,
    delegated.map((t) => t.responsible)
  );

  const delegatedToday = delegated
    .filter((t) => bucketByIso(t.term, todayIso) === "today")
    .slice(0, MAX_TASKS_PER_SECTION);

  const delegatedTomorrow = delegated
    .filter((t) => bucketByIso(t.term, todayIso) === "tomorrow")
    .slice(0, MAX_TASKS_PER_SECTION);

  const delegatedFuture = delegated
    .filter((t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue")
    .slice(0, MAX_TASKS_PER_SECTION);

  // =========================================================
  // 4) Em cópia (carbonCopies)
  // =========================================================
  const ccTasks = (await prisma.task.findMany({
    where: {
      status: { not: "done" },
      carbonCopies: { some: { slackUserId: userSlackId } },
      AND: [visibleWhere],
    },
    orderBy: [{ term: "asc" }, { createdAt: "desc" }],
    // ✅ agora puxa description também
    select: { id: true, title: true, description: true, term: true, urgency: true, responsible: true, delegation: true },
    take: 60,
  })) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
    delegation: string;
  }>;

  // ✅ resolve nomes de responsible + delegation
  const ccNameMap = await resolveSlackNames(
    slack,
    ccTasks.flatMap((t) => [t.responsible, t.delegation])
  );

  const ccToday = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "today").slice(0, MAX_TASKS_PER_SECTION);
  const ccTomorrow = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow").slice(0, MAX_TASKS_PER_SECTION);
  const ccFuture = ccTasks
    .filter((t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue")
    .slice(0, MAX_TASKS_PER_SECTION);

  // =========================================================
  // 5) Recorrências (lista)
  // =========================================================
  const recurrenceTasks = (await prisma.task.findMany({
    where: {
      responsible: userSlackId,
      status: { not: "done" },
      recurrence: { not: null },
      AND: [visibleWhere, excludeSelfDelegatedFromResponsible],
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, title: true, recurrence: true },
    take: 15,
  })) as unknown as Array<{ id: string; title: string; recurrence: string }>;

  // =========================================================
  // 6) Projetos (do usuário)
  // =========================================================
  const projects = await prisma.project.findMany({
    where: {
      status: "active",
      OR: [
        // ✅ criador sempre enxerga
        { createdBySlackId: userSlackId },

        // ✅ só entra se tiver alguma task no projeto envolvendo a pessoa
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
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const projectsWithCounts = await Promise.all(
    projects.map(async (p) => {
      const [openCount, doneCount, overdueCount] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id, status: { not: "done" }, AND: [visibleWhere] } }),
        prisma.task.count({ where: { projectId: p.id, status: "done" } }),
        prisma.task.count({
          where: {
            projectId: p.id,
            status: { not: "done" },
            term: { lt: todayUtc },
            AND: [visibleWhere],
          },
        }),
      ]);

      return { id: p.id, name: p.name, openCount, doneCount, overdueCount };
    })
  );

  // =========================================================
  // ✅ 6.5) Feedback: meus tickets abertos (pending/wip)
  // =========================================================
  const myOpenFeedback = await prisma.feedback.findMany({
    where: {
      createdBySlackId: userSlackId,
      status: { in: ["pending", "wip"] as any },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 8,
    select: { id: true, type: true, title: true, status: true, updatedAt: true },
  });

  // =========================================================
  // 7) Render Home
  // =========================================================
  const blocks = homeHeaderActionsBlocks().concat(
    homeTasksBlocks({
      tasksOverdue,
      tasksToday,
      tasksTomorrow,
      tasksFuture,

      delegatedToday: delegatedToday.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null, // ✅
      })),
      delegatedTomorrow: delegatedTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null, // ✅
      })),
      delegatedFuture: delegatedFuture.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null, // ✅
      })),

      ccToday: ccToday.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null, // ✅
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null, // ✅
      })),
      ccTomorrow: ccTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null, // ✅
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null, // ✅
      })),
      ccFuture: ccFuture.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description, // ✅
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null, // ✅
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null, // ✅
      })),

      recurrences: recurrenceTasks.map((r) => ({ id: r.id, title: r.title, recurrence: r.recurrence })),
      projects: projectsWithCounts,

      myOpenFeedback: myOpenFeedback.map((f) => ({
        id: f.id,
        type: f.type as any,
        title: f.title,
        status: f.status as any,
        updatedAt: f.updatedAt,
      })),
    })
  );

  await slack.views.publish({
    user_id: userSlackId,
    view: { type: "home", blocks },
  });
}
