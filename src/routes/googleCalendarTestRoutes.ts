import type { FastifyInstance } from "fastify";
import { google } from "googleapis";
import { getGoogleOAuthClient } from "../integrations/google/googleOAuth";
import { loadGoogleTokens } from "../integrations/google/tokenStoreFile";

export async function googleCalendarTestRoutes(app: FastifyInstance) {
  app.get("/google/calendar/test-create", async (_req, reply) => {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return reply.status(500).send("Missing GOOGLE_CALENDAR_ID");

    const tokens = await loadGoogleTokens();
    if (!tokens) {
      return reply
        .status(400)
        .send("Sem tokens. Faça OAuth em /oauth2/start primeiro.");
    }

    const oauth2 = getGoogleOAuthClient();
    oauth2.setCredentials(tokens);

    const calendar = google.calendar({ version: "v3", auth: oauth2 });

    // Evento com horário (exemplo)
    const start = "2026-02-03T10:00:00-03:00";
    const end = "2026-02-03T10:30:00-03:00";

    const res = await calendar.events.insert({
      calendarId,
      sendUpdates: "none", // troque pra "all" quando quiser mandar convite
      requestBody: {
        summary: "FTA • Teste de evento (OAuth)",
        description: "Evento criado via backend TS + Google Calendar API",
        start: { dateTime: start, timeZone: "America/Sao_Paulo" },
        end: { dateTime: end, timeZone: "America/Sao_Paulo" },
      },
    });

    return reply.send({
      ok: true,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink,
    });
  });
}
