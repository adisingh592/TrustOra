import type { EvaluationAdapter, VerificationStatus } from "@trustora/shared";
import { CHECK_FAILED_REASON } from "./core.js";
import type { StoredEvent, VerificationUpdate, Verifier, VerifierResult } from "./types.js";

const MAX_REASON_LENGTH = 200;

export const cleanReason = (reason: unknown, fallback: string): string => {
  if (typeof reason !== "string") return fallback;
  const line = reason.split(/[\r\n]/, 1)[0]!.trim();
  return line ? line.slice(0, MAX_REASON_LENGTH) : fallback;
};

const validDate = (value: unknown, fallback: Date): Date =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;

/**
 * Converts a verifier check result to a database verification update.
 *
 * Status transitions:
 * - MATCH: VERIFIED (evidence independently confirmed).
 * - MISMATCH: FAILED (evidence was verified and found invalid/inconsistent).
 * - BLOCKED: BLOCKED (authoritative integration/source is unavailable).
 * - Anything else: PENDING (evidence has not been confirmed yet).
 */
export const toVerificationUpdate = (result: VerifierResult, now: Date): VerificationUpdate => {
  const lastCheckedAt = validDate(result.checkedAt, now);
  const update = (
    verificationStatus: VerificationStatus,
    statusReason: string | null,
    verifiedAt: Date | null,
  ): VerificationUpdate => ({ verificationStatus, statusReason, lastCheckedAt, verifiedAt });

  if (result.outcome === "MATCH") return update("VERIFIED", null, lastCheckedAt);
  if (result.outcome === "MISMATCH") {
    return update("FAILED", cleanReason(result.reason, "The check found a mismatch."), null);
  }
  if (result.outcome === "BLOCKED") {
    return update("BLOCKED", cleanReason(result.reason, "The required integration is unavailable."), null);
  }
  return update("PENDING", cleanReason(result.reason, CHECK_FAILED_REASON), null);
};

/**
 * Creates a verifier for 0G inference requests.
 * Returns BLOCKED when 0G is not configured or unavailable.
 */
export const createInferenceVerifier = (adapter?: EvaluationAdapter | null): Verifier => {
  return async () => {
    const checkedAt = new Date();
    if (!adapter) {
      return { outcome: "BLOCKED", reason: "0G evaluation adapter is not configured.", checkedAt };
    }
    try {
      const health = await adapter.health();
      if (
        health.status === "NOT_CONFIGURED" ||
        health.status === "BLOCKED" ||
        health.status === "UNAVAILABLE" ||
        health.status === "FAILED"
      ) {
        return { outcome: "BLOCKED", reason: `0G evaluation adapter is ${health.status}.`, checkedAt };
      }
    } catch {
      return { outcome: "BLOCKED", reason: "0G evaluation adapter health check failed.", checkedAt };
    }
    return { outcome: "UNAVAILABLE", reason: "0G inference independent check not implemented yet.", checkedAt };
  };
};

/**
 * Creates a verifier for application events (e.g. agreement accepted).
 */
export const createApplicationEventVerifier = (): Verifier => {
  return async (event: StoredEvent) => {
    const checkedAt = new Date();
    if (!event.referenceValue || event.referenceValue.trim() === "") {
      return { outcome: "MISMATCH", reason: "Missing application event reference.", checkedAt };
    }
    return { outcome: "MATCH", checkedAt };
  };
};
