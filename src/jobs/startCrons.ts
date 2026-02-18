// src/jobs/startCrons.ts
import cron from "node-cron";
import { runTurboUrgencyReminderCron } from "./turboUrgencyReminderCron";
import { runLightUrgencyReminderCron } from "./lightUrgencyReminderCron";
import { runAsapUrgencyReminderCron } from "./asapUrgencyReminderCron";
import { runCutoffRolloverCron } from "./cutoffRolloverCron";

const TZ = "America/Sao_Paulo";

function safeRun(name: string, fn: () => Promise<void>) {
  fn().catch((err) => {
    console.error(`[crons] ${name} failed:`, err);
  });
}

function getCronEnv(name: string, fallback: string) {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
}

export function startCrons() {
  // 🔴 TURBO: a cada 30 min entre 09:00 e 18:30 (SP)
  cron.schedule(
    "0,30 9-18 * * *",
    () => safeRun("turboUrgencyReminderCron", runTurboUrgencyReminderCron),
    { timezone: TZ }
  );

  // 🟢 LIGHT: 10:00 e 16:00 (SP)
  cron.schedule(
    "0 10,16 * * *",
    () => safeRun("lightUrgencyReminderCron", runLightUrgencyReminderCron),
    { timezone: TZ }
  );

  // 🟡 ASAP: 10:00, 12:00 e 16:00 (SP)
  cron.schedule(
    "0 10,12,16 * * *",
    () => safeRun("asapUrgencyReminderCron", runAsapUrgencyReminderCron),
    { timezone: TZ }
  );

  // ✅ CUTOFF (SP) — agora via ENV
  // Exemplo de ENV: CUTOFF_ROLLOVER_CRON="0 20 * * *"
  const cutoffExpr = getCronEnv("CUTOFF_ROLLOVER_CRON", "0 20 * * *");

  if (!cron.validate(cutoffExpr)) {
    console.error(`[crons] invalid CUTOFF_ROLLOVER_CRON="${cutoffExpr}". Using fallback "0 20 * * *".`);
  }

  const cutoffFinalExpr = cron.validate(cutoffExpr) ? cutoffExpr : "0 20 * * *";

  cron.schedule(
    cutoffFinalExpr,
    () => safeRun("cutoffRolloverCron", runCutoffRolloverCron),
    { timezone: TZ }
  );

  // ✅ Debug opcional
  if (process.env.FORCE_TURBO_REMINDER === "1") safeRun("turboUrgencyReminderCron (forced)", runTurboUrgencyReminderCron);
  if (process.env.FORCE_LIGHT_REMINDER === "1") safeRun("lightUrgencyReminderCron (forced)", runLightUrgencyReminderCron);
  if (process.env.FORCE_ASAP_REMINDER === "1") safeRun("asapUrgencyReminderCron (forced)", runAsapUrgencyReminderCron);
  if (process.env.FORCE_CUTOFF_ROLLOVER === "1") safeRun("cutoffRolloverCron (forced)", runCutoffRolloverCron);

  console.log("[crons] scheduled", {
    tz: TZ,
    cutoff: cutoffFinalExpr,
  });
}
