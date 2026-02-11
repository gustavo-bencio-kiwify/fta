-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('light', 'asap', 'turbo');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'blocked', 'done', 'overdue');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'none');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'concluded');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBySlackId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "concludedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project-members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project-members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "delegation" TEXT NOT NULL,
    "delegationEmail" TEXT,
    "responsible" TEXT NOT NULL,
    "responsibleEmail" TEXT,
    "term" TIMESTAMP(3),
    "deadlineTime" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "recurrence" "Recurrence",
    "urgency" "Urgency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT,
    "recurrenceAnchor" TIMESTAMP(3),
    "dependsOnId" TEXT,
    "slackOpenChannelId" TEXT,
    "slackOpenMessageTs" TEXT,
    "googleEventId" TEXT,
    "googleEventLink" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task-carbon-copies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task-carbon-copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task-reminder-logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dateIso" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task-reminder-logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google-oauth-tokens" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "scope" TEXT,
    "tokenType" TEXT,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google-oauth-tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_createdBySlackId_idx" ON "projects"("createdBySlackId");

-- CreateIndex
CREATE INDEX "project-members_slackUserId_idx" ON "project-members"("slackUserId");

-- CreateIndex
CREATE INDEX "project-members_projectId_idx" ON "project-members"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project-members_projectId_slackUserId_key" ON "project-members"("projectId", "slackUserId");

-- CreateIndex
CREATE INDEX "task-carbon-copies_slackUserId_idx" ON "task-carbon-copies"("slackUserId");

-- CreateIndex
CREATE INDEX "task-carbon-copies_taskId_idx" ON "task-carbon-copies"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task-carbon-copies_taskId_slackUserId_key" ON "task-carbon-copies"("taskId", "slackUserId");

-- CreateIndex
CREATE INDEX "task-reminder-logs_dateIso_slot_idx" ON "task-reminder-logs"("dateIso", "slot");

-- CreateIndex
CREATE INDEX "task-reminder-logs_taskId_idx" ON "task-reminder-logs"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task-reminder-logs_taskId_dateIso_slot_key" ON "task-reminder-logs"("taskId", "dateIso", "slot");

-- AddForeignKey
ALTER TABLE "project-members" ADD CONSTRAINT "project-members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task-carbon-copies" ADD CONSTRAINT "task-carbon-copies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task-reminder-logs" ADD CONSTRAINT "task-reminder-logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

