/*
  Warnings:

  - The `recurrence` column on the `tasks` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'done', 'overdue');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual');

-- AlterTable
ALTER TABLE "task-carbon-copies" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadlineTime" TEXT,
ADD COLUMN     "delegationEmail" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "responsibleEmail" TEXT,
ADD COLUMN     "status" "TaskStatus" NOT NULL DEFAULT 'pending',
DROP COLUMN "recurrence",
ADD COLUMN     "recurrence" "Recurrence";

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task-carbon-copies_taskId_idx" ON "task-carbon-copies"("taskId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
