// src/server.ts
import { fastify } from "fastify";
import "dotenv/config";
import { createTask } from "./routes/createTask";
import { slackRoutes } from "./routes/slackRoutes";
import { debug } from "./routes/debugTables";
import { sendMessage } from "./routes/sendMessage";
import { startCrons } from "./jobs/startCrons";
import path from "node:path";
import fastifyStatic from "@fastify/static";

import { googleOAuthRoutes } from "./routes/googleOAuthRoutes";
import { googleCalendarTestRoutes } from "./routes/googleCalendarTestRoutes";

async function main() {
  const app = fastify({ logger: { level: "info" } });

  app.register(createTask);
  app.register(slackRoutes);
  app.register(debug);
  app.register(sendMessage);

  // ✅ DEBUG rápido: se aparecer undefined aqui, achamos o culpado
  console.log("[register] googleOAuthRoutes:", typeof googleOAuthRoutes);
  console.log("[register] googleCalendarTestRoutes:", typeof googleCalendarTestRoutes);

  app.register(fastifyStatic, {
    root: path.join(process.cwd(), "src", "public"),
    prefix: "/public/",
  });


  const port = Number(process.env.PORT ?? 3030);
  startCrons();

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`HTTP server running on ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
