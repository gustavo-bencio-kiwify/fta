// src/admin/auth.ts
import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const ADMIN_COOKIE_NAME = "fta_admin";

type SessionPayload = {
  v: 1;
  u: string;
  exp: number; // epoch seconds
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function base64urlEncode(buf: Buffer) {
  return buf.toString("base64url");
}

function base64urlDecode(s: string) {
  return Buffer.from(s, "base64url");
}

function hmacSha256(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function signAdminSession(args: { username: string; ttlMinutes?: number }) {
  const secret = mustEnv("ADMIN_SESSION_SECRET");
  const ttl = Math.max(5, Math.min(args.ttlMinutes ?? 12 * 60, 7 * 24 * 60));
  const payload: SessionPayload = {
    v: 1,
    u: args.username,
    exp: Math.floor(Date.now() / 1000) + ttl * 60,
  };
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmacSha256(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifyAdminSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expectedSig = hmacSha256(payloadB64, secret);
  if (!safeEqual(sig, expectedSig)) return null;

  try {
    const raw = base64urlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(raw) as SessionPayload;
    if (!payload || payload.v !== 1) return null;
    if (typeof payload.u !== "string" || !payload.u) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setAdminCookie(reply: FastifyReply, token: string) {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    // ✅ Render/https: use Secure em prod
    ...(isProd ? ["Secure"] : []),
  ];
  reply.header("Set-Cookie", parts.join("; "));
}

export function clearAdminCookie(reply: FastifyReply) {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isProd ? ["Secure"] : []),
  ];
  reply.header("Set-Cookie", parts.join("; "));
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply, next: () => void) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  const session = verifyAdminSession(token);
  if (!session) {
    const nextUrl = encodeURIComponent(request.url || "/admin");
    reply.redirect(`/admin/login?next=${nextUrl}`);
    return;
  }
  (request as any).adminUser = session.u;
  next();
}

export function getAdminUser(request: FastifyRequest): string | null {
  return ((request as any).adminUser as string | undefined) ?? null;
}
