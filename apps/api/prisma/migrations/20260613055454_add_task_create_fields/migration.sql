-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "effort" "EnergyLevel",
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "deadline" SET DATA TYPE TIMESTAMP(3);
