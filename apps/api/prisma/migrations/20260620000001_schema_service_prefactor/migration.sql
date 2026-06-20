-- Drop old unique index (userId, date)
DROP INDEX "DayPlan_userId_date_key";

-- Create new unique index (userId, date, status) — allows one DRAFT and one ACTIVE per user+date
CREATE UNIQUE INDEX "DayPlan_userId_date_status_key" ON "DayPlan"("userId", "date", "status");

-- Remove global backlog ordering column
ALTER TABLE "Task" DROP COLUMN "order";

-- Add per-block task ordering column (null when unscheduled)
ALTER TABLE "Task" ADD COLUMN "blockOrder" INTEGER;
