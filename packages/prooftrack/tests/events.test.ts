import { describe, expect, it } from "vitest";
import { validateEventInput } from "../src/events.js";
import { ProofTrackError } from "../src/types.js";

const validFunded = {
  publicProjectId: "TRU-PROJ-2026-0000001",
  occurredAt: "2026-01-01T00:00:00.000Z",
  ecosystem: "ARC",
  network: "Arc Testnet",
  chainId: 5042002,
  eventType: "MILESTONE_FUNDED",
  referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
  referenceValue: `0x${"a".repeat(64)}`,
};

describe("validateEventInput", () => {
  it("validates and normalizes valid event input", () => {
    const { input, normalizedReference, naturalKey } = validateEventInput(validFunded);
    expect(input.eventType).toBe("MILESTONE_FUNDED");
    expect(normalizedReference).toBe(`0x${"a".repeat(64)}`);
    expect(naturalKey).toEqual({
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      referenceValue: `0x${"a".repeat(64)}`,
      eventType: "MILESTONE_FUNDED",
    });
  });

  it("lowercases transaction hash references", () => {
    const { normalizedReference } = validateEventInput({
      ...validFunded,
      referenceValue: `0x${"A".repeat(64)}`,
    });
    expect(normalizedReference).toBe(`0x${"a".repeat(64)}`);
  });

  it("rejects mismatched ecosystem / referenceType", () => {
    expect(() =>
      validateEventInput({
        ...validFunded,
        referenceType: "INFERENCE_REQUEST_ID",
      }),
    ).toThrow(ProofTrackError);
  });

  it("rejects wrong chainId for Arc events", () => {
    expect(() =>
      validateEventInput({
        ...validFunded,
        chainId: 1,
      }),
    ).toThrow(ProofTrackError);
  });

  it("rejects non-hex string as transaction hash", () => {
    expect(() =>
      validateEventInput({
        ...validFunded,
        referenceValue: "not-a-tx-hash",
      }),
    ).toThrow(ProofTrackError);
  });

  it("rejects invalid input schema (missing required fields)", () => {
    expect(() => validateEventInput({})).toThrow(ProofTrackError);
  });
});
