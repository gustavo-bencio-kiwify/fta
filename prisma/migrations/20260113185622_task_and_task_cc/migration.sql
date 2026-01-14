-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "delegation" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "term" DATETIME,
    "recurrence" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "task-carbon-copies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task-carbon-copies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "task-carbon-copies_slackUserId_idx" ON "task-carbon-copies"("slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "task-carbon-copies_taskId_slackUserId_key" ON "task-carbon-copies"("taskId", "slackUserId");
