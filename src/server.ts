// src/server.ts
import { fastify } from "fastify";
import "dotenv/config";
import { createTask } from "./routes/createTask";
import { slackRoutes } from "./routes/slackRoutes";
import { debug } from "./routes/debugTables";
import { sendMessage } from "./routes/sendMessage";
import { startCrons } from "./jobs/startCrons";

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

  // ✅ prefix /google => rotas ficam /google/oauth2/start etc
  await app.register(googleOAuthRoutes, { prefix: "/google" });
  await app.register(googleCalendarTestRoutes, { prefix: "/google" });

  const port = Number(process.env.PORT ?? 3030);
  startCrons();

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`HTTP server running on ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
