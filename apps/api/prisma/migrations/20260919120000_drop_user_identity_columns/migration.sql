-- CLERK-6: Clerk is now the source of truth for identity and every row is
-- linked, so drop the local identity columns and make the Clerk anchor required.
-- Precondition: every "User" row has a non-null "clerkUserId" (CLERK-3 import).

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email",
DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "passwordHash",
ALTER COLUMN "clerkUserId" SET NOT NULL;
