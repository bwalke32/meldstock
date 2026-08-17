-- Historical Connection rows did not record consent or initiation. Adding a
-- PENDING default safely makes every existing row require reconfirmation;
-- requestedByUserId and acceptedAt intentionally remain NULL.
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- The exported repository's historical migrations contain only Better Auth.
-- Keep this isolated migration verifiable on a fresh database while remaining
-- a no-op for the already-existing legacy Connection table.
CREATE TABLE IF NOT EXISTS "Connection" (
    "id" TEXT NOT NULL,
    "userIdA" TEXT NOT NULL,
    "userIdB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Connection_userIdA_userIdB_key"
    ON "Connection"("userIdA", "userIdB");

ALTER TABLE "Connection"
    ADD COLUMN "requestedByUserId" TEXT,
    ADD COLUMN "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "acceptedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "Connection_userIdA_idx";
DROP INDEX IF EXISTS "Connection_userIdB_idx";

CREATE INDEX "Connection_userIdA_status_idx" ON "Connection"("userIdA", "status");
CREATE INDEX "Connection_userIdB_status_idx" ON "Connection"("userIdB", "status");
CREATE INDEX "Connection_requestedByUserId_status_idx" ON "Connection"("requestedByUserId", "status");
