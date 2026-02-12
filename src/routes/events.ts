// src/routes/events.ts
import type { FastifyInstance } from "fastify";
import type { WebClient } from "@slack/web-api";
import { publishHome } from "../services/publishHome";
import { importTasksFromExcelSlackFile } from "../services/importTasksFromExcel";

// anti-duplicação simples (Slack retry). Em produção ideal: persistir em DB.
const seenEventIds = new Set<string>();

export async function events(app: FastifyInstance, slack: WebClient) {
  app.post("/events", async (req, reply) => {
    const body = req.body as any;

    // URL verification
    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    // Sempre ACK 200 rápido
    reply.status(200).send();

    // Slack retries (evita duplicar)
    const retryNum = (req.headers["x-slack-retry-num"] ?? null) as string | null;
    if (retryNum) return;

    const eventId = String(body?.event_id ?? "");
    if (eventId) {
      if (seenEventIds.has(eventId)) return;
      seenEventIds.add(eventId);
      // limpa depois de um tempo
      setTimeout(() => seenEventIds.delete(eventId), 10 * 60 * 1000).unref?.();
    }

    if (body?.type !== "event_callback") return;

    const event = body.event;

    // Home opened
    if (event?.type === "app_home_opened") {
      if (event.user) await publishHome(slack, event.user);
      return;
    }

    // Mensagens no DM
    if (event?.type === "message" && event?.channel_type === "im") {
      // ignora mensagens do próprio bot / edits / etc
      if (event.bot_id) return;
      if (!event.user) return;

      // tem arquivo?
      const files = Array.isArray(event.files) ? event.files : [];
      if (!files.length) return;

      // pega o primeiro xlsx
      const xlsx = files.find((f: any) => {
        const name = String(f?.name ?? "").toLowerCase();
        const mimetype = String(f?.mimetype ?? "").toLowerCase();
        return name.endsWith(".xlsx") || mimetype.includes("spreadsheetml");
      });

      if (!xlsx) return;

      const channelId = String(event.channel);
      const threadTs = String(event.thread_ts ?? event.ts); // se mandou na thread, responde na thread

      // roda async
      void importTasksFromExcelSlackFile({
        slack,
        uploadedBySlackId: event.user,
        channelId,
        threadTs,
        file: xlsx,
      }).catch((e) => {
        req.log.error({ e }, "[EVENTS] importTasksFromExcelSlackFile failed");
      });

      return;
    }
  });
}
