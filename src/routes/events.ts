// src/slack/routes/events.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma"; // <-- ajuste o caminho se necessário
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

export async function events(app: FastifyInstance, slack: WebClient) {
  app.post("/events", async (req, reply) => {
    const body = req.body as any;

    // URL verification (Slack Events)
    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    if (body?.type === "event_callback") {
      const event = body.event;

      if (event?.type === "app_home_opened") {
        const userId = event.user as string;

        const now = new Date();
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);

        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStart = startOfDay(tomorrow);
        const tomorrowEnd = endOfDay(tomorrow);

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

        // 3) Split Hoje / Amanhã / Futuras
        const tasksToday = tasks.filter(
          (t) => t.term && new Date(t.term) >= todayStart && new Date(t.term) <= todayEnd
        );

        const tasksTomorrow = tasks.filter(
          (t) =>
            t.term &&
            new Date(t.term) >= tomorrowStart &&
            new Date(t.term) <= tomorrowEnd
        );

        const tasksFuture = tasks.filter(
          (t) => t.term && new Date(t.term) > tomorrowEnd
        );

        // (Opcional) Sem prazo -> jogar em Futuras ou criar "Sem prazo"
        // const tasksNoTerm = tasks.filter((t) => !t.term);

        // 4) Publica a HOME completa (botões + lista)
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
