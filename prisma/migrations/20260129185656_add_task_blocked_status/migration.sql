-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'blocked';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "dependsOnId" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
