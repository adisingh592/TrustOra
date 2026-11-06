import { describe, expect, it } from "vitest";
import {
  AcceptAgreementBodySchema,
  AgentPaymentRequestSchema,
  CreateProjectBodySchema,
  EvaluationResultSchema,
  PositiveAmountSchema,
  ProofEventExpectedSchema,
  RecordProofEventInputSchema,
  ProjectStatusSchema,
  ProofEventSchema,
  PublicProjectIdSchema,
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
