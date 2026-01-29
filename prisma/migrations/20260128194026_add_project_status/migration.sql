-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'concluded');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "concludedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'active';
