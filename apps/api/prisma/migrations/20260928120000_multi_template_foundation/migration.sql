-- CreateExtension (already installed for Project.name; kept for fresh-DB safety)
CREATE EXTENSION IF NOT EXISTS "citext";

-- Add DayTemplate.name. It is required going forward, but existing rows have no
-- value, so add nullable, backfill the single per-user template to "My Day"
-- (the same seed name onboarding gives a new user's first template), then
-- enforce NOT NULL.
ALTER TABLE "DayTemplate" ADD COLUMN "name" CITEXT;
UPDATE "DayTemplate" SET "name" = 'My Day' WHERE "name" IS NULL;
ALTER TABLE "DayTemplate" ALTER COLUMN "name" SET NOT NULL;

-- A user may now hold many templates: drop one-per-user uniqueness, make names
-- unique per user instead.
DROP INDEX "DayTemplate_userId_key";
CREATE UNIQUE INDEX "DayTemplate_userId_name_key" ON "DayTemplate"("userId", "name");

-- DayPlan records the template it was generated from. Deleting that template
-- nulls the link (SetNull) rather than cascading, so plan history keeps its
-- snapshotted blocks.
ALTER TABLE "DayPlan" ADD COLUMN "dayTemplateId" TEXT;
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_dayTemplateId_fkey" FOREIGN KEY ("dayTemplateId") REFERENCES "DayTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
