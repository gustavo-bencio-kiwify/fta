import { FastifyInstance } from "fastify";
import { createTaskService } from "../services/createTaskService";

export async function createTask(app: FastifyInstance) {
  app.post("/createTask", async (request, reply) => {
    try {
      const task = await createTaskService(request.body);
      return reply.send({ ok: true, taskId: task.id });
    } catch (err: any) {
      request.log.error(err);
      return reply.code(400).send({
        ok: false,
        error: err?.issues ?? err?.message ?? "Invalid payload",
      });
    }
  });
}
