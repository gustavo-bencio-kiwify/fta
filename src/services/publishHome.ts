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

  const tasks: HomeTaskItem[] = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    delegation: t.delegation,
    term: t.term,
    urgency: normalizeUrgency(t.urgency),
  }));

  const tasksToday = tasks.filter(
    (t) => t.term && new Date(t.term) >= todayStart && new Date(t.term) <= todayEnd
  );
  const tasksTomorrow = tasks.filter(
    (t) => t.term && new Date(t.term) >= tomorrowStart && new Date(t.term) <= tomorrowEnd
  );
  const tasksFuture = tasks.filter((t) => t.term && new Date(t.term) > tomorrowEnd);

  await slack.views.publish({
    user_id: userId,
    view: homeView({ tasksToday, tasksTomorrow, tasksFuture }),
  });
}
