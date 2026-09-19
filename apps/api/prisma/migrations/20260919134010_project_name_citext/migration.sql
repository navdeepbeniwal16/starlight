-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "name" SET DATA TYPE CITEXT;
