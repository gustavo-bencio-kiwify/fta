ALTER TABLE "projects"
ADD COLUMN "createdBySlackId" TEXT;

CREATE INDEX "projects_createdBySlackId_idx" ON "projects" ("createdBySlackId");
