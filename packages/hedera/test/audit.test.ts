import { test } from "node:test";
import assert from "node:assert/strict";
import { HederaAuditService, JUDGE_EXPLANATION, TECH_ROLES } from "../src/audit";

test("HederaAuditService: technology roles table covers all 5 technologies", () => {
  assert.equal(TECH_ROLES.length, 5);
  const names = TECH_ROLES.map((t) => t.technology);
  assert.deepEqual(names, ["Hedera", "Arc", "0G", "Arkiv", "ProofTrack"]);
  const hederaRole = TECH_ROLES.find((t) => t.technology === "Hedera");
  assert.equal(hederaRole?.role, "Optional blockchain-based project records and auditability");
});

test("HederaAuditService: judge explanation is exact and clear", () => {
  assert.match(JUDGE_EXPLANATION, /Hedera was considered as an additional blockchain infrastructure layer/);
  assert.match(JUDGE_EXPLANATION, /primary evidence-anchoring architecture uses Arkiv/);
  assert.match(JUDGE_EXPLANATION, /Arc handles optional payment settlement/);
});

test("HederaAuditService: reports NOT_CONFIGURED honestly when keys missing", () => {
  const service = new HederaAuditService({});
  assert.equal(service.isConfigured(), false);

  const res = service.recordAgreementAcceptance({
    projectId: "TRU-PROJ-2026-0001050",
    versionNumber: 1,
    criteriaHash: "abc1234",
    clientAddress: "0xClient",
    freelancerAddress: "0xFreelancer",
  });

  assert.equal(res.status, "NOT_CONFIGURED");
  assert.equal(res.activityType, "AGREEMENT_ACCEPTED");
  assert.equal(res.projectId, "TRU-PROJ-2026-0001050");
  assert.equal(res.payload.protocol, "TRUSTORA-HCS-v1");
  assert.match(res.payloadHash, /^[0-9a-f]{64}$/);
  assert.match(res.explanation, /Hedera audit layer is optional and unconfigured/);
});

test("HederaAuditService: records milestone completion with deliverable hash", () => {
  const service = new HederaAuditService({});
  const res = service.recordMilestoneCompletion({
    projectId: "TRU-PROJ-2026-0001050",
    milestoneIndex: 1,
    deliverableHash: "deadbeef1234",
    releasedTo: "0xFreelancer",
    amountUsdc: 1.0,
    releaseTxHash: "0xReleaseTx",
  });

  assert.equal(res.activityType, "MILESTONE_COMPLETED");
  assert.equal(res.payload.details.milestoneIndex, 1);
  assert.equal(res.payload.details.deliverableHash, "deadbeef1234");
  assert.equal(res.payload.details.releaseTxHash, "0xReleaseTx");
});

test("HederaAuditService: records 0G AI activity verification", () => {
  const service = new HederaAuditService({});
  const res = service.recordActivityVerification({
    projectId: "TRU-PROJ-2026-0001050",
    milestoneIndex: 1,
    verdict: "PASS",
    modelId: "0gm-1.0-35b-a3b",
    requestId: "0g-req-999",
    reportHash: "reporthash123",
  });

  assert.equal(res.activityType, "ACTIVITY_VERIFIED");
  assert.equal(res.payload.details.verdict, "PASS");
  assert.equal(res.payload.details.modelId, "0gm-1.0-35b-a3b");
  assert.equal(res.payload.details.requestId, "0g-req-999");
});

test("HederaAuditService: verifies on Mirror Node with mock fetch", async () => {
  const mockFetch = (async (url: string | URL | Request) => {
    assert.match(String(url), /transactions\/0.0.1234-1700000000-000000000/);
    return new Response(
      JSON.stringify({
        transactions: [{ result: "SUCCESS", consensus_timestamp: "1700000000.123456789" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const service = new HederaAuditService({ fetchImpl: mockFetch });
  const check = await service.verifyOnMirrorNode("0.0.1234@1700000000.000000000");

  assert.equal(check.verified, true);
  assert.equal(check.consensusTimestamp, "1700000000.123456789");
  assert.equal(
    check.hashscanUrl,
    "https://hashscan.io/testnet/transaction/0.0.1234%401700000000.000000000"
  );
});

test("HederaAuditService: when configured with credentials, status is PENDING_CONSENSUS", () => {
  const service = new HederaAuditService({
    accountId: "0.0.99999",
    privateKey: "302e020100...",
    topicId: "0.0.88888",
  });

  assert.equal(service.isConfigured(), true);
  assert.equal(service.getTopicHashScanUrl(), "https://hashscan.io/testnet/topic/0.0.88888");

  const res = service.recordAuditReference({
    projectId: "TRU-PROJ-2026-0001050",
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: "0x123456",
  });

  assert.equal(res.status, "PENDING_CONSENSUS");
  assert.equal(res.configured, true);
  assert.equal(res.topicId, "0.0.88888");
  assert.equal(res.hashscanUrl, "https://hashscan.io/testnet/topic/0.0.88888");
});
