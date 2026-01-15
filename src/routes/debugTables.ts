import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma";

export async function createTask(app:FastifyInstance) {

   app.get("/debug/db/tables", async (req, reply) => {
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
  `;
  return reply.send(tables);
});


}