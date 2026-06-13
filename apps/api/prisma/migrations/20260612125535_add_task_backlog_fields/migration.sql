-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deadline" DATE,
ADD COLUMN     "priority" "Priority",
ADD COLUMN     "progress" INTEGER;
