// src/routes/googleOAuthRoutes.ts
import type { FastifyPluginAsync } from "fastify";
import { google } from "googleapis";
import { prisma } from "../lib/prisma";

const TOKEN_ROW_ID = "calendar";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getOAuth2Client() {
  const clientId = mustEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = mustEnv("GOOGLE_REDIRECT_URI");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export const googleOAuthRoutes: FastifyPluginAsync = async (app) => {
  // GET /google/oauth2/start  (se você registrar com prefix "/google")
  app.get("/oauth2/start", async (_req, reply) => {
    const oauth2 = getOAuth2Client();

    const redirectUri = mustEnv("GOOGLE_REDIRECT_URI");
    app.log.info(`[oauth2/start] redirectUri = ${redirectUri}`);

    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
    });

    app.log.info(`[oauth2/start] authUrl = ${authUrl}`);
    return reply.redirect(authUrl);
  });

  // GET /google/oauth2/callback?code=...
  app.get("/oauth2/callback", async (req, reply) => {
    const oauth2 = getOAuth2Client();

    const code = (req.query as any)?.code as string | undefined;
    if (!code) {
      return reply.code(400).send({ ok: false, error: "missing_code" });
    }

    const { tokens } = await oauth2.getToken(code);

    const accessToken = tokens.access_token ?? null;
    const refreshTokenFromGoogle = tokens.refresh_token ?? null;
    const scope = tokens.scope ?? null;
    const tokenType = tokens.token_type ?? null;
    const expiryDate =
      typeof tokens.expiry_date === "number" ? new Date(tokens.expiry_date) : null;

    // ✅ não perder refreshToken (Google nem sempre devolve)
    const existing = await prisma.googleOAuthToken.findUnique({
      where: { id: TOKEN_ROW_ID },
      select: { refreshToken: true },
    });

    const refreshTokenToSave = refreshTokenFromGoogle ?? existing?.refreshToken ?? null;

    if (!refreshTokenToSave) {
      return reply.code(500).send({
        ok: false,
        error:
          "no_refresh_token_returned. Remova o app nas permissões da conta Google e autentique de novo (prompt=consent).",
      });
    }

    // ✅ upsert robusto (create + update)
    await prisma.googleOAuthToken.upsert({
      where: { id: TOKEN_ROW_ID },
      create: {
        id: TOKEN_ROW_ID,
        refreshToken: refreshTokenToSave,
        accessToken,
        scope,
        tokenType,
        expiryDate,
      },
      update: {
        // só atualiza refreshToken se o Google mandou um novo
        ...(refreshTokenFromGoogle ? { refreshToken: refreshTokenFromGoogle } : {}),
        accessToken,
        scope,
        tokenType,
        expiryDate,
      },
    });

    return reply.send({
      ok: true,
      saved: true,
      hasRefreshToken: true,
      calendarId: process.env.GOOGLE_CALENDAR_ID,
    });
  });
};
