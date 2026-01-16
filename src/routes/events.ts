// src/slack/routes/events.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { homeView } from "../views/homeView";
import type { HomeTaskItem, Urgency } from "../views/homeTasksBlocks";

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

// compara por dia (UTC) pra não dar briga de fuso
function ymdUTC(d: Date) {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function termKeyUTC(term: HomeTaskItem["term"]) {
  if (!term) return null;
  const d = term instanceof Date ? term : new Date(term);
  if (Number.isNaN(d.getTime())) return null;
  return ymdUTC(d);
}

export async function events(app: FastifyInstance, slack: WebClient) {
  app.post("/events", async (req, reply) => {
    const body = req.body as any;

    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    if (body?.type === "event_callback") {
      const event = body.event;

      if (event?.type === "app_home_opened") {
        const userId = event.user as string;

        // 1) Busca tasks do usuário (responsible)
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

        // 2) Converte para o tipo do front
        const tasks: HomeTaskItem[] = rawTasks.map(toHomeTaskItem);

        // 3) Chaves de hoje/amanhã em UTC
        const now = new Date();
        const todayKey = ymdUTC(now);

        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const tomorrowKey = ymdUTC(tomorrow);

        // 4) Split Hoje / Amanhã / Futuras por chave (YYYY-MM-DD)
        const tasksToday = tasks.filter((t) => termKeyUTC(t.term) === todayKey);
        const tasksTomorrow = tasks.filter((t) => termKeyUTC(t.term) === tomorrowKey);
        const tasksFuture = tasks.filter((t) => {
          const k = termKeyUTC(t.term);
          return k !== null && k > tomorrowKey;
        });

        // (Opcional) sem prazo:
        // const tasksNoTerm = tasks.filter((t) => !t.term);

        // DEBUG (depois remove)
        console.log("HOME user:", userId);
        console.log("todayKey:", todayKey, "tomorrowKey:", tomorrowKey);
        console.log("tasks:", tasks.map(t => ({ id: t.id, term: t.term, key: termKeyUTC(t.term) })));

        await slack.views.publish({
          user_id: userId,
          view: homeView({
            tasksToday,
            tasksTomorrow,
            tasksFuture,
          }),
        });
      }
    }

    return reply.status(200).send();
  });
}
