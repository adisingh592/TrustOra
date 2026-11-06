import { describe, expect, it } from "vitest";
import {
  AgentPaymentRequestSchema,
  EvaluationResultSchema,
  ProofEventSchema,
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
