-- 1) projects.createdBySlackId
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "createdBySlackId" TEXT;

CREATE INDEX IF NOT EXISTS "projects_createdBySlackId_idx"
  ON "projects" ("createdBySlackId");

-- 2) tasks.updatedAt (NOT NULL com DEFAULT para não quebrar rows existentes)
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- 3) task thread refs (pra reminders)
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "slackOpenChannelId" TEXT,
  ADD COLUMN IF NOT EXISTS "slackOpenMessageTs" TEXT;
