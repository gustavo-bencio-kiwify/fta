-- 1) Campos na Task para guardar eventId/link
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "googleEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleEventLink" TEXT;

-- 2) Tabela para guardar refresh_token (1 registro: name="calendar")
CREATE TABLE IF NOT EXISTS "google-oauth-tokens" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google-oauth-tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "google-oauth-tokens_name_key"
  ON "google-oauth-tokens"("name");
