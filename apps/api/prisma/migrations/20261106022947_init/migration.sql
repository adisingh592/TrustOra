-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicProjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "freelancerId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "onchainMilestoneId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "deadline" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgreementVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "agreementHash" TEXT NOT NULL,
    "clientAcceptedAt" DATETIME,
    "freelancerAcceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgreementVersion_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "privateFilePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "aiConsent" BOOLEAN NOT NULL,
    "aiConsentAt" DATETIME,
    "status" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "AgreementVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProofEvent" (
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
    "summary" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicProjectId_key" ON "Project"("publicProjectId");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "Project_freelancerId_idx" ON "Project"("freelancerId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_onchainMilestoneId_key" ON "Milestone"("onchainMilestoneId");

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementVersion_milestoneId_version_key" ON "AgreementVersion"("milestoneId", "version");

-- CreateIndex
CREATE INDEX "Submission_milestoneId_idx" ON "Submission"("milestoneId");

-- CreateIndex
CREATE INDEX "Submission_freelancerId_idx" ON "Submission"("freelancerId");

-- CreateIndex
CREATE INDEX "Submission_agreementVersionId_idx" ON "Submission"("agreementVersionId");

-- CreateIndex
CREATE INDEX "Evaluation_submissionId_idx" ON "Evaluation"("submissionId");

-- CreateIndex
CREATE INDEX "ProofEvent_publicProjectId_idx" ON "ProofEvent"("publicProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofEvent_referenceType_referenceValue_eventType_key" ON "ProofEvent"("referenceType", "referenceValue", "eventType");
