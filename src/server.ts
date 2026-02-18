// src/server.ts
import { fastify } from "fastify";
import "dotenv/config";
import { slackRoutes } from "./routes/slackRoutes";
import { sendMessage } from "./routes/sendMessage";
import { startCrons } from "./jobs/startCrons";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { googleOAuthRoutes } from "./routes/googleOAuthRoutes";
import { googleCalendarTestRoutes } from "./routes/googleCalendarTestRoutes";
import { startPruneDoneTasksCron } from "./jobs/pruneDoneTasksCron";
import { adminRoutes } from "./routes/admin";

async function main() {
  const app = fastify({ logger: { level: "info" } });

  app.register(slackRoutes);
  app.register(sendMessage);
  app.register(adminRoutes);


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
const isDev = process.env.NODE_ENV !== "production";
const runLocalCrons = process.env.RUN_LOCAL_CRONS === "true";

// ✅ Rodar automaticamente em dev (ou via flag)
if (isDev || runLocalCrons) {
  startPruneDoneTasksCron({
    // em dev recomendo rodar no boot pra você testar
    runOnBoot: true,

    // schedule real (todo dia 03:10 SP)
    cronExpr: "10 3 * * *",
    timezone: "America/Sao_Paulo",
    days: 7,
  });
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
