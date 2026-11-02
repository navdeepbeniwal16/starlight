-- A template's blocks are wholly owned by it and have no meaning once it's gone,
-- hence CASCADE. Previously RESTRICT (Prisma's default for a required relation),
-- which forced callers to clear a template's blocks by hand before deleting it.
ALTER TABLE "DayTemplateBlock" DROP CONSTRAINT "DayTemplateBlock_dayTemplateId_fkey";
ALTER TABLE "DayTemplateBlock" ADD CONSTRAINT "DayTemplateBlock_dayTemplateId_fkey" FOREIGN KEY ("dayTemplateId") REFERENCES "DayTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
