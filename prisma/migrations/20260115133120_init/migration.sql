-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "delegation" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "term" TIMESTAMP(3),
    "recurrence" TEXT,
    "urgency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task-carbon-copies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task-carbon-copies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task-carbon-copies_slackUserId_idx" ON "task-carbon-copies"("slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "task-carbon-copies_taskId_slackUserId_key" ON "task-carbon-copies"("taskId", "slackUserId");

-- AddForeignKey
ALTER TABLE "task-carbon-copies" ADD CONSTRAINT "task-carbon-copies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
