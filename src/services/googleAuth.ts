// src/services/googleAuth.ts
import { prisma } from "../lib/prisma";

const TOKEN_ROW_ID = "calendar";
const EXPIRY_SKEW_MS = 60_000; // 1 min de folga

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getGoogleAccessToken(): Promise<string> {
  const row = await prisma.googleOAuthToken.findUnique({
    where: { id: TOKEN_ROW_ID },
    select: { refreshToken: true, accessToken: true, expiryDate: true },
  });

  const now = Date.now();

  // ✅ se ainda está válido, reutiliza
  if (row?.accessToken && row.expiryDate && row.expiryDate.getTime() - now > EXPIRY_SKEW_MS) {
    return row.accessToken;
  }

  const refreshToken = row?.refreshToken;
  if (!refreshToken) {
    throw new Error(
      "No refreshToken found in DB. Rode /google/oauth2/start e finalize o consentimento para salvar o refresh_token."
    );
  }

  const clientId = mustEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustEnv("GOOGLE_CLIENT_SECRET");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const raw = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`Google token refresh failed (${tokenRes.status}): ${raw}`);
  }

  const json = JSON.parse(raw) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!json.access_token) {
    throw new Error(`Google token refresh returned no access_token: ${raw}`);
  }

  const accessToken = json.access_token;
  const expiresInSec = Number(json.expires_in ?? 3600);
  const expiryDate = new Date(Date.now() + expiresInSec * 1000);

  // ✅ mais robusto que update
  await prisma.googleOAuthToken.upsert({
    where: { id: TOKEN_ROW_ID },
    create: {
      id: TOKEN_ROW_ID,
      refreshToken, // mantém o refreshToken que já existe
      accessToken,
      expiryDate,
      scope: json.scope ?? null,
      tokenType: json.token_type ?? null,
    },
    update: {
      accessToken,
      expiryDate,
      scope: json.scope ?? undefined,
      tokenType: json.token_type ?? undefined,
    },
  });

  return accessToken;
}
