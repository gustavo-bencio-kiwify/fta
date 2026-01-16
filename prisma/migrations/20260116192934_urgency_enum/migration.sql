/*
  Warnings:

  - Changed the type of `urgency` on the `tasks` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('light', 'asap', 'turbo');

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "urgency",
ADD COLUMN     "urgency" "Urgency" NOT NULL;
