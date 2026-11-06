import { describe, expect, it } from "vitest";
import {
  cleanReason,
  createApplicationEventVerifier,
  createInferenceVerifier,
  toVerificationUpdate,
} from "../src/verification.js";
import type { StoredEvent } from "../src/types.js";

const makeEvent = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "event_1",
  publicProjectId: "TRU-PROJ-2026-0000001",
  milestoneId: null,
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:01.000Z"),
  ecosystem: "APPLICATION",
  network: "APPLICATION",
  chainId: null,
  eventType: "AGREEMENT_ACCEPTED_CLIENT",
  referenceType: "APPLICATION_EVENT_ID",
  referenceValue: "app_event_123",
  verificationStatus: "PENDING",
  statusReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  summary: "Client accepted.",
  expected: {},
  ...over,
});

describe("toVerificationUpdate", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("converts MATCH to VERIFIED with verifiedAt set", () => {
    const update = toVerificationUpdate({ outcome: "MATCH", checkedAt: now }, now);
    expect(update).toEqual({
      verificationStatus: "VERIFIED",
      statusReason: null,
      lastCheckedAt: now,
      verifiedAt: now,
    });
  });

  it("converts MISMATCH to FAILED with reason and null verifiedAt", () => {
    const update = toVerificationUpdate(
      { outcome: "MISMATCH", reason: "Data mismatch", checkedAt: now },
      now,
    );
    expect(update).toEqual({
      verificationStatus: "FAILED",
      statusReason: "Data mismatch",
      lastCheckedAt: now,
      verifiedAt: null,
    });
  });

  it("converts BLOCKED to BLOCKED status with reason", () => {
    const update = toVerificationUpdate(
      { outcome: "BLOCKED", reason: "Integration not configured", checkedAt: now },
      now,
    );
    expect(update).toEqual({
      verificationStatus: "BLOCKED",
      statusReason: "Integration not configured",
      lastCheckedAt: now,
      verifiedAt: null,
    });
  });

  it("converts UNAVAILABLE to PENDING", () => {
    const update = toVerificationUpdate(
      { outcome: "UNAVAILABLE", reason: "Check timed out", checkedAt: now },
      now,
    );
    expect(update).toEqual({
      verificationStatus: "PENDING",
      statusReason: "Check timed out",
      lastCheckedAt: now,
      verifiedAt: null,
    });
  });

  it("cleanReason limits length and strips stack traces", () => {
    const dirty = "Single line reason\n    at Function.execute (/app/server.ts:42)";
    expect(cleanReason(dirty, "fallback")).toBe("Single line reason");
    expect(cleanReason(123, "fallback")).toBe("fallback");
  });
});

describe("createInferenceVerifier", () => {
  it("returns BLOCKED when adapter is null", async () => {
    const verifier = createInferenceVerifier(null);
    const event = makeEvent({
      ecosystem: "ZERO_G",
      eventType: "EVALUATION_COMPLETED",
      referenceType: "INFERENCE_REQUEST_ID",
      referenceValue: "req_123",
    });
    const result = await verifier(event);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.reason).toContain("not configured");
  });

  it("returns BLOCKED when adapter health is NOT_CONFIGURED", async () => {
    const mockAdapter = {
      evaluate: async () => {
        throw new Error("unimplemented");
      },
      health: async () => ({
        status: "NOT_CONFIGURED" as const,
        detail: "unconfigured",
        checkedAt: new Date().toISOString(),
      }),
    };
    const verifier = createInferenceVerifier(mockAdapter);
    const event = makeEvent({
      ecosystem: "ZERO_G",
      eventType: "EVALUATION_COMPLETED",
      referenceType: "INFERENCE_REQUEST_ID",
      referenceValue: "req_123",
    });
    const result = await verifier(event);
    expect(result.outcome).toBe("BLOCKED");
  });
});

describe("createApplicationEventVerifier", () => {
  it("matches when referenceValue is non-empty", async () => {
    const verifier = createApplicationEventVerifier();
    const event = makeEvent({ referenceValue: "valid_ref" });
    const result = await verifier(event);
    expect(result.outcome).toBe("MATCH");
  });

  it("fails with MISMATCH when referenceValue is empty", async () => {
    const verifier = createApplicationEventVerifier();
    const event = makeEvent({ referenceValue: "   " });
    const result = await verifier(event);
    expect(result.outcome).toBe("MISMATCH");
  });
});
