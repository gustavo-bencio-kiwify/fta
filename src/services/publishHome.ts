// src/services/publishHome.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { homeView } from "../views/homeView";
import type { HomeTaskItem, Urgency } from "../views/homeTasksBlocks";

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

// ✅ NÃO trate 1970 como sem prazo.
// Apenas valida se é uma Date real.
function normalizeDbTerm(term: Date | null): Date | null {
  if (!term) return null;
  if (Number.isNaN(term.getTime())) return null;
  return term;
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
    term: normalizeDbTerm(t.term),
    urgency: normalizeUrgency(t.urgency),
  };
}

export async function publishHome(slack: WebClient, userId: string) {
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

  // ✅ só considera tarefas com term válido (Date)
  const withTerm = tasks.filter((t) => t.term instanceof Date && !Number.isNaN(t.term.getTime()));

  const tasksOverdue = withTerm.filter((t) => t.term! < todayStart);

  const tasksToday = withTerm.filter((t) => t.term! >= todayStart && t.term! <= todayEnd);

  const tasksTomorrow = withTerm.filter((t) => t.term! >= tomorrowStart && t.term! <= tomorrowEnd);

  const tasksFuture = withTerm.filter((t) => t.term! > tomorrowEnd);

  await slack.views.publish({
    user_id: userId,
    view: homeView({
      tasksOverdue,
      tasksToday,
      tasksTomorrow,
      tasksFuture,
    }),
  });
}
