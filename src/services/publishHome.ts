// src/services/publishHome.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

import { homeTasksBlocks } from "../views/homeTasksBlocks";
import { homeHeaderActionsBlocks } from "../views/homeHeaderActions";

import type { Prisma } from "../generated/prisma/browser";

const SAO_PAULO_TZ = "America/Sao_Paulo";

// ✅ limites
const MAX_BLOCKS = 100;
const TODAY_MAX = 20;
const TOMORROW_MAX = 20;
const FUTURE_PAGE_SIZE = 10;

// =========================================================
// ✅ Slack ID -> Nome (cache)
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

// ✅ ordenação: turbo > asap > light, depois data (term), depois createdAt desc
// ✅ ordenação: data (term ASC), depois urgência (turbo > asap > light), depois createdAt DESC
const URGENCY_RANK: Record<string, number> = { turbo: 0, asap: 1, light: 2 };

function timeMs(term: Date | null) {
  if (!term || Number.isNaN(term.getTime())) return Number.POSITIVE_INFINITY;
  return term.getTime();
}

function sortTasks<A extends { urgency: string; term: Date | null; createdAt?: Date | null }>(arr: A[]) {
  return [...arr].sort((a, b) => {
    const ta = timeMs(a.term);
    const tb = timeMs(b.term);
    if (ta !== tb) return ta - tb;

    const ra = URGENCY_RANK[a.urgency] ?? 99;
    const rb = URGENCY_RANK[b.urgency] ?? 99;
    if (ra !== rb) return ra - rb;

    const ca = a.createdAt ? a.createdAt.getTime() : 0;
    const cb = b.createdAt ? b.createdAt.getTime() : 0;
    return cb - ca;
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const safePage = clamp(page ?? 0, 0, maxPage);
  const start = safePage * pageSize;
  const end = start + pageSize;
  return { total, page: safePage, pageSize, items: items.slice(start, end) };
}

type HomePaginationState = {
  myFuturePage: number;
  delegatedFuturePage: number;
  ccFuturePage: number;
};

const DEFAULT_STATE: HomePaginationState = {
  myFuturePage: 0,
  delegatedFuturePage: 0,
  ccFuturePage: 0,
};

type RawTask = {
  id: string;
  title: string;
  description: string | null;
  delegation: string;
  responsible: string;
  term: Date | null;
  urgency: "light" | "asap" | "turbo";
  recurrence: string | null;
  status: string;
  createdAt: Date;
};

export async function publishHome(
  slack: WebClient,
  userId: string,
  opts?: { state?: Partial<HomePaginationState> }
) {
  const userSlackId = userId;

  const state: HomePaginationState = {
    ...DEFAULT_STATE,
    ...(opts?.state ?? {}),
  };

  // =========================================================
  // 1) Datas base
  // =========================================================
  const now = new Date();
  const todayIso = getSaoPauloTodayIso(now);
  const todayUtc = new Date(`${todayIso}T00:00:00.000Z`);

  const visibleWhere: Prisma.TaskWhereInput = {
    OR: [{ dependsOnId: null }, { dependsOn: { status: "done" } }],
  };

  const excludeSelfDelegatedFromResponsible: Prisma.TaskWhereInput = {
    delegation: { not: userSlackId },
  };

  // =========================================================
  // 2) Minhas tarefas (responsible)
  // =========================================================
  const myTasksRaw = (await prisma.task.findMany({
    where: {
      responsible: userSlackId,
      status: { not: "done" },
      AND: [visibleWhere, excludeSelfDelegatedFromResponsible],
    },
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
      createdAt: true,
    },
  })) as unknown as RawTask[];

  const myTasks = sortTasks(myTasksRaw);

  const myDelegationNameMap = await resolveSlackNames(
    slack,
    myTasks.map((t) => t.delegation)
  );

  const myTodayAll = myTasks.filter((t) => bucketByIso(t.term, todayIso) === "today");
  const myTomorrowAll = myTasks.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow");
  const myFutureAll = myTasks.filter((t) => bucketByIso(t.term, todayIso) === "future");

  const tasksToday = myTodayAll.slice(0, TODAY_MAX).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    delegationName: myDelegationNameMap.get(t.delegation) ?? null,
    term: t.term,
    urgency: t.urgency,
  }));

  const tasksTomorrow = myTomorrowAll.slice(0, TOMORROW_MAX).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    delegationName: myDelegationNameMap.get(t.delegation) ?? null,
    term: t.term,
    urgency: t.urgency,
  }));

  const myFuturePag = paginate(myFutureAll, state.myFuturePage, FUTURE_PAGE_SIZE);

  const tasksFuture = myFuturePag.items.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    delegationName: myDelegationNameMap.get(t.delegation) ?? null,
    term: t.term,
    urgency: t.urgency,
  }));

  // (mantido por compatibilidade)
  const tasksOverdue: any[] = [];

  // =========================================================
  // 3) Delegadas por mim (delegation)
  // =========================================================
  const delegatedRaw = (await prisma.task.findMany({
    where: {
      delegation: userSlackId,
      status: { not: "done" },
      AND: [visibleWhere],
    },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      urgency: true,
      responsible: true,
      createdAt: true,
    },
    take: 200,
  })) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
    createdAt: Date;
  }>;

  const delegated = sortTasks(delegatedRaw);

  const delegatedResponsibleNameMap = await resolveSlackNames(
    slack,
    delegated.map((t) => t.responsible)
  );

  const delegatedTodayAll = delegated.filter((t) => bucketByIso(t.term, todayIso) === "today");
  const delegatedTomorrowAll = delegated.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow");
  const delegatedFutureAll = delegated.filter(
    (t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue"
  );

  const delegatedToday = delegatedTodayAll.slice(0, TODAY_MAX);
  const delegatedTomorrow = delegatedTomorrowAll.slice(0, TOMORROW_MAX);

  const delegatedFuturePag = paginate(delegatedFutureAll, state.delegatedFuturePage, FUTURE_PAGE_SIZE);
  const delegatedFuture = delegatedFuturePag.items;

  // =========================================================
  // 4) Em cópia (carbonCopies)
  // =========================================================
  const ccRaw = (await prisma.task.findMany({
    where: {
      status: { not: "done" },
      carbonCopies: { some: { slackUserId: userSlackId } },
      AND: [visibleWhere],
    },
    select: {
      id: true,
      title: true,
      description: true,
      term: true,
      urgency: true,
      responsible: true,
      delegation: true,
      createdAt: true,
    },
    take: 200,
  })) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    term: Date | null;
    urgency: "light" | "asap" | "turbo";
    responsible: string;
    delegation: string;
    createdAt: Date;
  }>;

  const ccTasks = sortTasks(ccRaw);

  const ccNameMap = await resolveSlackNames(
    slack,
    ccTasks.flatMap((t) => [t.responsible, t.delegation])
  );

  const ccTodayAll = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "today");
  const ccTomorrowAll = ccTasks.filter((t) => bucketByIso(t.term, todayIso) === "tomorrow");
  const ccFutureAll = ccTasks.filter(
    (t) => bucketByIso(t.term, todayIso) === "future" || bucketByIso(t.term, todayIso) === "overdue"
  );

  const ccToday = ccTodayAll.slice(0, TODAY_MAX);
  const ccTomorrow = ccTomorrowAll.slice(0, TOMORROW_MAX);

  const ccFuturePag = paginate(ccFutureAll, state.ccFuturePage, FUTURE_PAGE_SIZE);
  const ccFuture = ccFuturePag.items;

  // =========================================================
  // 5) Recorrências
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
  // 6) Projetos
  // =========================================================
  const projects = await prisma.project.findMany({
    where: {
      status: "active",
      OR: [
        { createdBySlackId: userSlackId },
        { members: { some: { slackUserId: userSlackId } } },
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
          where: { projectId: p.id, status: { not: "done" }, term: { lt: todayUtc }, AND: [visibleWhere] },
        }),
      ]);
      return { id: p.id, name: p.name, openCount, doneCount, overdueCount };
    })
  );

  // =========================================================
  // 6.5) Feedback
  // =========================================================
  const myOpenFeedback = await prisma.feedback.findMany({
    where: { createdBySlackId: userSlackId, status: { in: ["pending", "wip"] as any } },
    orderBy: [{ updatedAt: "desc" }],
    take: 8,
    select: { id: true, type: true, title: true, status: true, updatedAt: true },
  });

  // =========================================================
  // 7) Render Home
  // =========================================================
  let blocks = homeHeaderActionsBlocks().concat(
    homeTasksBlocks({
      tasksOverdue,
      tasksToday,
      tasksTomorrow,
      tasksFuture,

      delegatedToday: delegatedToday.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null,
      })),
      delegatedTomorrow: delegatedTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null,
      })),
      delegatedFuture: delegatedFuture.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: delegatedResponsibleNameMap.get(t.responsible) ?? null,
      })),

      ccToday: ccToday.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null,
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null,
      })),
      ccTomorrow: ccTomorrow.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null,
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null,
      })),
      ccFuture: ccFuture.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        term: t.term,
        urgency: t.urgency,
        responsible: t.responsible,
        responsibleName: ccNameMap.get(t.responsible) ?? null,
        delegation: t.delegation,
        delegationName: ccNameMap.get(t.delegation) ?? null,
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

      // ✅ pager infos
      myFuturePager: { scope: "my", page: myFuturePag.page, pageSize: myFuturePag.pageSize, total: myFuturePag.total },
      delegatedFuturePager: {
        scope: "delegated",
        page: delegatedFuturePag.page,
        pageSize: delegatedFuturePag.pageSize,
        total: delegatedFuturePag.total,
      },
      ccFuturePager: { scope: "cc", page: ccFuturePag.page, pageSize: ccFuturePag.pageSize, total: ccFuturePag.total },
    } as any)
  );

  // ✅ guarda de segurança (se ainda assim estourar por algum motivo)
  if (blocks.length > MAX_BLOCKS) {
    console.warn(`[HOME] too many blocks: ${blocks.length}. trimming to ${MAX_BLOCKS}`);
    blocks = blocks.slice(0, MAX_BLOCKS);
  }

  await slack.views.publish({
    user_id: userSlackId,
    view: {
      type: "home",
      private_metadata: JSON.stringify({
        myFuturePage: myFuturePag.page,
        delegatedFuturePage: delegatedFuturePag.page,
        ccFuturePage: ccFuturePag.page,
      }),
      blocks,
    },
  });
}