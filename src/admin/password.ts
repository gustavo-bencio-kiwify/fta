// src/admin/password.ts
// ✅ Sem dependências externas (bcrypt/argon2)
// ✅ Hash forte com scrypt + salt randômico
import crypto from "node:crypto";

const KEYLEN = 32;
const SALT_LEN = 16;

function b64url(buf: Buffer) {
  return buf.toString("base64url");
}

function fromB64url(s: string) {
  return Buffer.from(s, "base64url");
}

function safeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = crypto.scryptSync(password, salt, KEYLEN) as Buffer;
  // formato versionado
  return `scrypt$${b64url(salt)}$${b64url(derived)}`;
}

export function verifyPassword(password: string, stored: string) {
  // esperado: scrypt$<salt_b64url>$<hash_b64url>
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algo, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;

  try {
    const salt = fromB64url(saltB64);
    const expected = fromB64url(hashB64);
    const derived = crypto.scryptSync(password, salt, expected.length) as Buffer;
    return safeEqual(derived, expected);
  } catch {
    return false;
  }
}
