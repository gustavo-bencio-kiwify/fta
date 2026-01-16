import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma";

export async function debug(app:FastifyInstance) {

  app.get("/debug/me/:id", async (req, reply) => {
  const id = (req.params as any).id;
  const tasks = await prisma.task.findMany({
    where: { responsible: id },
    select: { id: true, title: true, responsible: true, delegation: true, term: true, urgency: true },
  });
  return reply.send(tasks);
});
  
}
