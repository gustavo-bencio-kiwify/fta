// src/slack/routes/events.ts (ou onde estiver)
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";
import { homeTasksView } from "../views/homeTaskView";

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

export async function events(app: FastifyInstance, slack: WebClient) {
  app.post("/events", async (req, reply) => {
    const body = req.body as any;

    // URL verification
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

        // Pega tarefas em que o usuário é responsável
        const tasks = await prisma.task.findMany({
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

        const tasksToday = tasks.filter(
          (t) => t.term && t.term >= todayStart && t.term <= todayEnd
        );
        const tasksTomorrow = tasks.filter(
          (t) => t.term && t.term >= tomorrowStart && t.term <= tomorrowEnd
        );
        const tasksFuture = tasks.filter(
          (t) => t.term && t.term > tomorrowEnd
        );

        await slack.views.publish({
          user_id: userId,
          view: homeTasksView({
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
