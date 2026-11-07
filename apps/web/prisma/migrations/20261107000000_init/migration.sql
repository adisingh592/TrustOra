-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLIENT',
    "displayName" TEXT,
    "reputationScore" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clientAddress" TEXT NOT NULL,
    "freelancerAddress" TEXT,
    "arbiterAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "budgetUsdc" TEXT NOT NULL,
    "escrowContractAddress" TEXT,
    "registerTxHash" TEXT,
    "arcChainId" INTEGER NOT NULL DEFAULT 5042002,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "requiredSkills" TEXT,
    "expectedDurationDays" INTEGER,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "criteriaJson" TEXT NOT NULL,
    "criteriaHash" TEXT NOT NULL,
    "clientAccepted" BOOLEAN NOT NULL DEFAULT false,
    "clientSignature" TEXT,
    "freelancerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "freelancerSignature" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountUsdc" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UNFUNDED',
    "criteriaHash" TEXT,
    "addTxHash" TEXT,
    "fundingTxHash" TEXT,
    "releaseTxHash" TEXT,
    "fundedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deliverableHash" TEXT NOT NULL,
    "deliverableUri" TEXT,
    "contentSummary" TEXT,
    "content" TEXT,
    "anchorTxHash" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationReport" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "overallVerdict" TEXT NOT NULL,
    "inferenceRequestId" TEXT,
    "requestIdSource" TEXT,
    "providerAddress" TEXT,
    "teeVerified" BOOLEAN,
    "teeVerifiedBy" TEXT,
    "modelId" TEXT,
    "criteriaResultsJson" TEXT NOT NULL,
    "findingsJson" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "advisoryNotice" TEXT NOT NULL DEFAULT 'ADVISORY_ONLY_CANNOT_RELEASE_FUNDS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPayment" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "evaluationId" TEXT,
    "serviceName" TEXT NOT NULL,
    "providerAccount" TEXT NOT NULL,
    "amountTinybars" TEXT NOT NULL,
    "txId" TEXT,
    "status" TEXT NOT NULL,
    "hashscanUrl" TEXT,
    "policyDecision" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofTrackEventRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceValue" TEXT NOT NULL,
    "explorerUrl" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofTrackEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectApplication" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "applicantAddress" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL,
    "address" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStarted" BIGINT NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPayment_idempotencyKey_key" ON "AgentPayment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProofTrackEventRecord_projectId_referenceType_referenceValu_key" ON "ProofTrackEventRecord"("projectId", "referenceType", "referenceValue");

-- CreateIndex
CREATE UNIQUE INDEX "ProofTrackEventRecord_projectId_sequence_key" ON "ProofTrackEventRecord"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "ProjectApplication_applicantAddress_idx" ON "ProjectApplication"("applicantAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApplication_projectId_applicantAddress_key" ON "ProjectApplication"("projectId", "applicantAddress");

-- CreateIndex
CREATE INDEX "Session_address_idx" ON "Session"("address");

-- AddForeignKey
ALTER TABLE "AgreementVersion" ADD CONSTRAINT "AgreementVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationReport" ADD CONSTRAINT "EvaluationReport_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPayment" ADD CONSTRAINT "AgentPayment_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofTrackEventRecord" ADD CONSTRAINT "ProofTrackEventRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectApplication" ADD CONSTRAINT "ProjectApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

