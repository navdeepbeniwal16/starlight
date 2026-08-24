-- Convert existing NO_TASK blocks before dropping the enum value.
UPDATE "DayTemplateBlock" SET "type" = 'ANCHOR' WHERE "type" = 'NO_TASK';
UPDATE "PlannedBlock" SET "type" = 'ANCHOR' WHERE "type" = 'NO_TASK';

-- AlterEnum
BEGIN;
CREATE TYPE "BlockType_new" AS ENUM ('CONTAINER', 'ANCHOR');
ALTER TABLE "DayTemplateBlock" ALTER COLUMN "type" TYPE "BlockType_new" USING ("type"::text::"BlockType_new");
ALTER TABLE "PlannedBlock" ALTER COLUMN "type" TYPE "BlockType_new" USING ("type"::text::"BlockType_new");
ALTER TYPE "BlockType" RENAME TO "BlockType_old";
ALTER TYPE "BlockType_new" RENAME TO "BlockType";
DROP TYPE "BlockType_old";
COMMIT;
