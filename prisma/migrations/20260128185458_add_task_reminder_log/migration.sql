-- CreateTable
CREATE TABLE "task-reminder-logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dateIso" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task-reminder-logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task-reminder-logs_dateIso_slot_idx" ON "task-reminder-logs"("dateIso", "slot");

-- CreateIndex
CREATE INDEX "task-reminder-logs_taskId_idx" ON "task-reminder-logs"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task-reminder-logs_taskId_dateIso_slot_key" ON "task-reminder-logs"("taskId", "dateIso", "slot");

-- AddForeignKey
ALTER TABLE "task-reminder-logs" ADD CONSTRAINT "task-reminder-logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
