-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProofEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicProjectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "chainId" INTEGER,
    "eventType" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceValue" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verifiedAt" DATETIME,
    "explorerUrl" TEXT,
    "summary" TEXT NOT NULL,
    "statusReason" TEXT,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedJson" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_ProofEvent" ("chainId", "ecosystem", "eventType", "explorerUrl", "id", "milestoneId", "network", "occurredAt", "publicProjectId", "referenceType", "referenceValue", "summary", "verificationStatus", "verifiedAt") SELECT "chainId", "ecosystem", "eventType", "explorerUrl", "id", "milestoneId", "network", "occurredAt", "publicProjectId", "referenceType", "referenceValue", "summary", "verificationStatus", "verifiedAt" FROM "ProofEvent";
DROP TABLE "ProofEvent";
ALTER TABLE "new_ProofEvent" RENAME TO "ProofEvent";
CREATE INDEX "ProofEvent_publicProjectId_idx" ON "ProofEvent"("publicProjectId");
CREATE UNIQUE INDEX "ProofEvent_referenceType_referenceValue_eventType_key" ON "ProofEvent"("referenceType", "referenceValue", "eventType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
