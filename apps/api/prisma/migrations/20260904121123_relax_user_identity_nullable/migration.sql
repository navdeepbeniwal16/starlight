-- Identity moves to Clerk: drop NOT NULL so JIT-provisioned users need only clerkUserId.
-- Columns are retained (the import slice still reads them) and dropped later in CLERK-6.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "firstName" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastName" DROP NOT NULL;
