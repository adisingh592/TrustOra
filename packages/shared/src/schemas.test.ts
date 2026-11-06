import { describe, expect, it } from "vitest";
import {
  AcceptAgreementBodySchema,
  AnchorEntityKeySchema,
  AnchorPayloadSchema,
  AgentPaymentRequestSchema,
  CreateProjectBodySchema,
  EvaluationResultSchema,
  PaymentModeSchema,
  PositiveAmountSchema,
  ProofEventExpectedSchema,
  RecordProofEventInputSchema,
  ProjectStatusSchema,
  ProofEventSchema,
  PublicProjectIdSchema,
  RiskLevelSchema,
  ScopeGuardReportSchema,
  TaevaEvaluationReportSchema,
  TrustShieldReportSchema,
  UnifiedTrustReportSchema,
  WalletAddressSchema,
} from "./schemas.js";

// Test inputs only. These values are not real chain or inference data.
const proofEvent = {
  id: "test-event",
  publicProjectId: "test-project",
  occurredAt: "2026-01-01T00:00:00.000Z",
  ecosystem: "ARC",
  network: "Arc Testnet",
  chainId: 5042002,
  eventType: "MILESTONE_FUNDED",
  referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
  referenceValue: `0x${"a".repeat(64)}`,
  verificationStatus: "PENDING",
  summary: "test event",
};

const evaluationResult = {
  overall: "PASS",
  criteria: [{ criterion: "c1", status: "PASS", evidence: "e1" }],
  limitations: [],
  suggestedRevisions: [],
  criteriaVersion: "v1",
  submissionHash: "test-submission-hash",
  modelId: "test-model",
  promptHash: "test-prompt-hash",
  requestId: "test-request-id",
  reportHash: "test-report-hash",
};

describe("ProofEventSchema", () => {
  it("accepts a valid transaction hash", () => {
    expect(ProofEventSchema.safeParse(proofEvent).success).toBe(true);
  });

  it("rejects a request ID passed as BLOCKCHAIN_TRANSACTION_HASH", () => {
    const result = ProofEventSchema.safeParse({
      ...proofEvent,
      referenceValue: "test-request-id",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["referenceValue"]);
  });

  it("accepts a request ID as INFERENCE_REQUEST_ID", () => {
    const result = ProofEventSchema.safeParse({
      ...proofEvent,
      referenceType: "INFERENCE_REQUEST_ID",
      referenceValue: "test-request-id",
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["ecosystem", "SOLANA"],
    ["referenceType", "UNKNOWN_REFERENCE"],
    ["verificationStatus", "MAYBE"],
  ])("rejects an unknown %s", (field, value) => {
    const result = ProofEventSchema.safeParse({ ...proofEvent, [field]: value });
    expect(result.success).toBe(false);
  });
});

describe("EvaluationResultSchema", () => {
  it("accepts a complete result", () => {
    expect(EvaluationResultSchema.safeParse(evaluationResult).success).toBe(true);
  });

  it("rejects a missing requestId", () => {
    const { requestId: _omitted, ...withoutRequestId } = evaluationResult;
    const result = EvaluationResultSchema.safeParse(withoutRequestId);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["requestId"]);
  });

  it("rejects an unknown criterion status", () => {
    const result = EvaluationResultSchema.safeParse({
      ...evaluationResult,
      criteria: [{ criterion: "c1", status: "MAYBE", evidence: "e1" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("amounts", () => {
  const request = {
    providerPayTo: "test-provider",
    amount: "1500000",
    network: "test-network",
    asset: "USDC",
    resourceUrl: "test-resource",
  };

  it("accepts whole base units as a string", () => {
    expect(AgentPaymentRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([[1500000], ["1.5"]])("rejects %s", (amount) => {
    const result = AgentPaymentRequestSchema.safeParse({ ...request, amount });
    expect(result.success).toBe(false);
  });
});

describe("project input schemas", () => {
  const wallet = (digit: string) => `0x${digit.repeat(40)}`;
  const milestone = {
    title: "m1",
    amount: "50000000",
    deadline: "2099-01-01T00:00:00Z",
    criteria: ["c1"],
  };
  const body = {
    title: "t",
    description: "d",
    freelancerWallet: wallet("a"),
    arbiterWallet: wallet("b"),
    milestones: [milestone],
  };

  it("accepts a valid project and normalises the deadline", () => {
    const parsed = CreateProjectBodySchema.parse(body);
    expect(parsed.milestones[0]?.deadline).toBe("2099-01-01T00:00:00.000Z");
  });

  it.each([
    ["0"],
    ["-1"],
    ["-5"],
    ["1.5"],
    ["007"],
    ["050"],
    ["abc"],
    [""],
    [" 1"],
    ["1e6"],
    ["0x10"],
    ["1000000000000001"],
    ["9".repeat(31)],
    ["9".repeat(79)],
    [1500000],
  ])("rejects amount %s", (amount) => {
    expect(PositiveAmountSchema.safeParse(amount).success).toBe(false);
  });

  it.each([["1"], ["50000000"], ["1000000000000000"]])("accepts amount %s", (amount) => {
    expect(PositiveAmountSchema.safeParse(amount).success).toBe(true);
  });

  it("lowercases a valid wallet", () => {
    const checksum = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(WalletAddressSchema.parse(checksum)).toBe(checksum.toLowerCase());
  });

  it.each([
    ["too short", "0x1234"],
    ["not hex", `0x${"g".repeat(40)}`],
    ["bad checksum", "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"],
    ["zero address", `0x${"0".repeat(40)}`],
    ["not a string", 42],
  ])("rejects a wallet: %s", (_label, value) => {
    expect(WalletAddressSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["agreementHash"],
    ["status"],
    ["clientId"],
    ["onchainMilestoneId"],
  ])("rejects a client-supplied %s", (field) => {
    expect(CreateProjectBodySchema.safeParse({ ...body, [field]: "x" }).success).toBe(false);
    const inMilestone = { ...body, milestones: [{ ...milestone, [field]: "x" }] };
    expect(CreateProjectBodySchema.safeParse(inMilestone).success).toBe(false);
  });

  it.each([
    ["no milestones", { milestones: [] }],
    ["too many milestones", { milestones: Array.from({ length: 11 }, (_, i) => ({ ...milestone, title: `m${i}` })) }],
    ["empty title", { title: "   " }],
    ["title too long", { title: "x".repeat(121) }],
    ["description too long", { description: "x".repeat(2001) }],
    ["no criteria", { milestones: [{ ...milestone, criteria: [] }] }],
    ["too many criteria", { milestones: [{ ...milestone, criteria: Array.from({ length: 11 }, (_, i) => `c${i}`) }] }],
    ["criteria item too long", { milestones: [{ ...milestone, criteria: ["x".repeat(501)] }] }],
    ["bad deadline", { milestones: [{ ...milestone, deadline: "tomorrow" }] }],
  ])("rejects %s", (_label, change) => {
    expect(CreateProjectBodySchema.safeParse({ ...body, ...change }).success).toBe(false);
  });

  it("validates ProjectStatusSchema", () => {
    expect(ProjectStatusSchema.safeParse("DRAFT").success).toBe(true);
    expect(ProjectStatusSchema.safeParse("AGREED").success).toBe(true);
    expect(ProjectStatusSchema.safeParse("INVALID").success).toBe(false);
  });

  it("accept body takes a positive whole version and nothing else", () => {
    expect(AcceptAgreementBodySchema.safeParse({ version: 1 }).success).toBe(true);
    for (const version of [0, -1, 1.5, "1", null]) {
      expect(AcceptAgreementBodySchema.safeParse({ version }).success).toBe(false);
    }
    expect(AcceptAgreementBodySchema.safeParse({ version: 1, role: "client" }).success).toBe(false);
  });

  it("recognises only the real project ID format", () => {
    expect(PublicProjectIdSchema.safeParse("TRU-PROJ-2026-0001042").success).toBe(true);
    for (const id of ["TRU-PROJ-2026-104", "TRU-PROJ-2025-0001042", "x"]) {
      expect(PublicProjectIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe("ProofTrack input schemas", () => {
  const input = {
    publicProjectId: "TRU-PROJ-2026-0001042",
    occurredAt: "2026-01-01T00:00:00Z",
    ecosystem: "ARC",
    network: "Arc Testnet",
    chainId: 5042002,
    eventType: "MILESTONE_FUNDED",
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: `0x${"a".repeat(64)}`,
  };

  it("accepts valid input, normalises the time and defaults expected to empty", () => {
    const parsed = RecordProofEventInputSchema.parse(input);
    expect(parsed.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.expected).toEqual({});
  });

  it.each([
    ["publicProjectId", "not-a-project"],
    ["occurredAt", "yesterday"],
    ["ecosystem", "SOLANA"],
    ["eventType", "MADE_UP"],
    ["referenceType", "MADE_UP"],
    ["network", " "],
    ["chainId", 1.5],
  ])("rejects a bad %s", (field, value) => {
    expect(RecordProofEventInputSchema.safeParse({ ...input, [field]: value }).success).toBe(false);
  });

  it("a caller cannot set a status or anything else extra", () => {
    for (const extra of [{ verificationStatus: "VERIFIED" }, { lastCheckedAt: "x" }, { id: "x" }]) {
      expect(RecordProofEventInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  it("expected lowercases addresses and hashes", () => {
    const parsed = ProofEventExpectedSchema.parse({
      agreementHash: "A".repeat(64),
      onchainMilestoneId: `0x${"B".repeat(64)}`,
      freelancerWallet: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    });
    expect(parsed.agreementHash).toBe("a".repeat(64));
    expect(parsed.onchainMilestoneId).toBe(`0x${"b".repeat(64)}`);
    expect(parsed.freelancerWallet).toBe("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  });

  it.each([
    ["a number amount", { amountBaseUnits: 50000000 }],
    ["a decimal amount", { amountBaseUnits: "1.5" }],
    ["a short hash", { agreementHash: "abc" }],
    ["a bad address", { tokenAddress: "0x1234" }],
    ["a file path", { privateFilePath: "/private/file.zip" }],
  ])("expected rejects %s", (_label, expected) => {
    expect(ProofEventExpectedSchema.safeParse(expected).success).toBe(false);
  });
});

describe("PaymentMode and RiskLevel schemas", () => {
  it("validates payment modes", () => {
    expect(PaymentModeSchema.safeParse("ARC_ESCROW").success).toBe(true);
    expect(PaymentModeSchema.safeParse("EXTERNAL_PAYMENT").success).toBe(true);
    expect(PaymentModeSchema.safeParse("UNKNOWN_MODE").success).toBe(false);
  });

  it("validates risk levels", () => {
    expect(RiskLevelSchema.safeParse("LOW").success).toBe(true);
    expect(RiskLevelSchema.safeParse("MEDIUM").success).toBe(true);
    expect(RiskLevelSchema.safeParse("HIGH").success).toBe(true);
    expect(RiskLevelSchema.safeParse("CRITICAL").success).toBe(false);
  });
});

describe("CreateProjectBody with payment modes", () => {
  const sampleBody = {
    title: "t",
    description: "d",
    freelancerWallet: `0x${"a".repeat(40)}`,
    arbiterWallet: `0x${"b".repeat(40)}`,
    milestones: [
      {
        title: "m1",
        amount: "50000000",
        deadline: "2099-01-01T00:00:00Z",
        criteria: ["c1"],
      },
    ],
  };

  it("defaults paymentMode to ARC_ESCROW when omitted", () => {
    const parsed = CreateProjectBodySchema.parse(sampleBody);
    expect(parsed.paymentMode).toBe("ARC_ESCROW");
  });

  it("accepts explicit EXTERNAL_PAYMENT", () => {
    const parsed = CreateProjectBodySchema.parse({
      ...sampleBody,
      paymentMode: "EXTERNAL_PAYMENT",
    });
    expect(parsed.paymentMode).toBe("EXTERNAL_PAYMENT");
  });

  it("rejects an invalid paymentMode", () => {
    const result = CreateProjectBodySchema.safeParse({
      ...sampleBody,
      paymentMode: "BITCOIN_ESCROW",
    });
    expect(result.success).toBe(false);
  });
});

describe("TAEVA, ScopeGuard, TrustShield & Unified Trust Report schemas", () => {
  const taevaReport = {
    milestoneId: "m1",
    submissionId: "sub1",
    fileHash: "a".repeat(64),
    deterministicChecks: {
      hashVerified: true,
      deadlineMet: true,
      agreementAccepted: true,
      aiConsentGranted: true,
    },
    criteriaResults: [
      {
        criterion: "Pass all unit tests",
        status: "PASS",
        evidence: "Deterministic test run exited with code 0",
      },
    ],
    overallStatus: "PASS",
    isAdvisory: true,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    explanation: "Deliverable satisfies all deterministic and advisory criteria.",
    requestId: "req-12345",
    reportHash: "b".repeat(64),
  };

  const scopeGuardReport = {
    publicProjectId: "TRU-PROJ-2026-0001042",
    baseVersion: 1,
    targetVersion: 2,
    hasChanges: true,
    milestoneDiffs: [
      {
        milestoneId: "m1",
        title: "Milestone 1",
        type: "MODIFIED",
        deadlineShiftDays: 2,
        amountDeltaBaseUnits: "0",
        criteriaDiffs: [
          {
            type: "ADDED",
            criterion: "New criteria requirement",
          },
        ],
      },
    ],
    totalAmountDeltaBaseUnits: "0",
    totalDeadlineShiftDays: 2,
    timelineRisk: "LOW",
    costRisk: "LOW",
    overallRisk: "LOW",
    approvalStatus: {
      clientAccepted: true,
      freelancerAccepted: false,
      isFullyAccepted: false,
    },
    summary: "1 modified milestone with 1 added criterion, 2-day timeline shift.",
  };

  const trustShieldReport = {
    publicProjectId: "TRU-PROJ-2026-0001042",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    deadlineAdherence: {
      level: "LOW",
      reason: "All active milestones are within their agreed schedule.",
    },
    scopeVolatility: {
      level: "LOW",
      reason: "Agreement has normal version progression (2 versions).",
    },
    submissionHistory: {
      level: "LOW",
      reason: "First-time submission without repeated revision cycles.",
    },
    disputeHistory: {
      level: "LOW",
      reason: "Zero active disputes or arbitration requests.",
    },
    overallRisk: "LOW",
    overallConfidence: 0.95,
    explanation: "Project exhibits healthy communication and schedule adherence.",
    heuristicNotes: [
      "Risk indicators are advisory heuristics and do not automate fund movements.",
    ],
  };

  it("validates TaevaEvaluationReportSchema", () => {
    expect(TaevaEvaluationReportSchema.safeParse(taevaReport).success).toBe(true);
    // isAdvisory must be true
    expect(
      TaevaEvaluationReportSchema.safeParse({ ...taevaReport, isAdvisory: false }).success,
    ).toBe(false);
  });

  it("validates ScopeGuardReportSchema", () => {
    expect(ScopeGuardReportSchema.safeParse(scopeGuardReport).success).toBe(true);
  });

  it("validates TrustShieldReportSchema", () => {
    expect(TrustShieldReportSchema.safeParse(trustShieldReport).success).toBe(true);
  });

  it("validates UnifiedTrustReportSchema", () => {
    const unifiedReport = {
      publicProjectId: "TRU-PROJ-2026-0001042",
      paymentMode: "ARC_ESCROW",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectStatus: "ACTIVE",
      taevaSummary: {
        totalMilestones: 1,
        evaluatedMilestones: 1,
        evaluations: [taevaReport],
      },
      scopeGuardSummary: {
        totalVersions: 2,
        activeVersion: 1,
        hasPendingProposals: true,
        latestScopeChange: scopeGuardReport,
      },
      trustShieldSummary: trustShieldReport,
      proofTrackSummary: {
        totalEvents: 4,
        verifiedCount: 2,
        pendingCount: 2,
        failedCount: 0,
        ecosystemsInvolved: ["ARC", "ZERO_G", "APPLICATION"],
      },
      verifiableReportHash: "c".repeat(64),
      disclaimer: "Advisory trust report.",
    };
    expect(UnifiedTrustReportSchema.safeParse(unifiedReport).success).toBe(true);
  });
});

describe("Arkiv anchor schemas", () => {
  const payload = {
    projectId: "TRU-PROJ-2026-0001042",
    eventType: "MILESTONE_FUNDED",
    eventDigest: "a".repeat(64),
    network: "Arc Testnet",
    reference: `0x${"b".repeat(64)}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  it("an entity key is 32 bytes of 0x hex, stored lowercase", () => {
    expect(AnchorEntityKeySchema.parse(`0x${"A".repeat(64)}`)).toBe(`0x${"a".repeat(64)}`);
    for (const key of ["0x1234", "a".repeat(64), `0x${"g".repeat(64)}`, 42]) {
      expect(AnchorEntityKeySchema.safeParse(key).success).toBe(false);
    }
  });

  it("accepts a payload, with or without a subject digest", () => {
    expect(AnchorPayloadSchema.safeParse(payload).success).toBe(true);
    expect(AnchorPayloadSchema.safeParse({ ...payload, subjectDigest: "c".repeat(64) }).success).toBe(true);
  });

  it.each(["title", "description", "fileName", "criteria", "wallet", "amountBaseUnits"])("refuses an extra %s", (field) => {
    expect(AnchorPayloadSchema.safeParse({ ...payload, [field]: "x" }).success).toBe(false);
  });

  it.each<[string, object]>([
    ["an uppercase digest", { eventDigest: "A".repeat(64) }],
    ["a short digest", { eventDigest: "abc" }],
    ["a bad subject digest", { subjectDigest: "abc" }],
    ["a reference over 128 bytes", { reference: "x".repeat(129) }],
    ["non-ASCII text", { network: "नेटवर्क" }],
    ["an empty network", { network: "" }],
    ["a bad time", { occurredAt: "yesterday" }],
    ["an unknown event type", { eventType: "MADE_UP" }],
    ["a bad project ID", { projectId: "x" }],
  ])("refuses %s", (_label, change) => {
    expect(AnchorPayloadSchema.safeParse({ ...payload, ...change }).success).toBe(false);
  });

  it("a reference of exactly 128 characters is allowed", () => {
    expect(AnchorPayloadSchema.safeParse({ ...payload, reference: "x".repeat(128) }).success).toBe(true);
  });
});
