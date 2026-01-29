-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "endDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project-members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project-members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project-members_slackUserId_idx" ON "project-members"("slackUserId");

-- CreateIndex
CREATE INDEX "project-members_projectId_idx" ON "project-members"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project-members_projectId_slackUserId_key" ON "project-members"("projectId", "slackUserId");

-- AddForeignKey
ALTER TABLE "project-members" ADD CONSTRAINT "project-members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
