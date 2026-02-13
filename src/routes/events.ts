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
      setTimeout(() => seenEventIds.delete(eventId), 10 * 60 * 1000).unref?.();
    }

    if (body?.type !== "event_callback") return;

    const event = body.event;

    // Home opened
    if (event?.type === "app_home_opened") {
      if (event.user) await publishHome(slack, event.user);
      return;
    }

    // Só queremos DM
    if (event?.type !== "message" || event?.channel_type !== "im") return;

    // ignora mensagens do próprio bot / edits / etc
    if (event.bot_id) return;
    if (!event.user) return;

    // ignora edits (message_changed etc)
    if (event.subtype && event.subtype !== "file_share") {
      // se você quiser permitir texto normal no DM depois, remova esse return
      return;
    }

    const files = Array.isArray(event.files) ? event.files : [];
    if (!files.length) return;

    // pega o primeiro xlsx
    let xlsx = files.find((f: any) => {
      const name = String(f?.name ?? "").toLowerCase();
      const mimetype = String(f?.mimetype ?? "").toLowerCase();
      return (
        name.endsWith(".xlsx") ||
        mimetype.includes("spreadsheetml") ||
        mimetype.includes("officedocument.spreadsheetml.sheet")
      );
    });

    if (!xlsx) return;

    // ✅ fallback: às vezes o Slack manda file incompleto no evento
    if (!xlsx.url_private_download && !xlsx.url_private) {
      const fileId = String(xlsx.id ?? "");
      if (fileId) {
        try {
          const info = await slack.files.info({ file: fileId });
          const full = (info.file as any) ?? null;
          if (full) xlsx = full;
        } catch (e) {
          req.log.error({ e, fileId }, "[EVENTS] files.info failed");
        }
      }
    }

    const channelId = String(event.channel);
    const threadTs = String(event.thread_ts ?? event.ts); // se mandou na thread, responde na thread

    void importTasksFromExcelSlackFile({
      slack,
      uploadedBySlackId: event.user,
      channelId,
      threadTs,
      file: xlsx,
    }).catch((e) => {
      req.log.error({ e }, "[EVENTS] importTasksFromExcelSlackFile failed");
    });
  });
}
