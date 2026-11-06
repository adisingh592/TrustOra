import type { Ecosystem, ProofEventType, ReferenceType } from "@trustora/shared";
import { ProofTrackError } from "./types.js";

/** The only ecosystem and reference type each event type may use. */
export const ALLOWED_COMBINATIONS: Readonly<
  Record<ProofEventType, { ecosystem: Ecosystem; referenceType: ReferenceType }>
> = {
  AGREEMENT_ACCEPTED_CLIENT: { ecosystem: "APPLICATION", referenceType: "APPLICATION_EVENT_ID" },
  AGREEMENT_ACCEPTED_FREELANCER: { ecosystem: "APPLICATION", referenceType: "APPLICATION_EVENT_ID" },
  MILESTONE_FUNDED: { ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" },
  WORK_SUBMITTED: { ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" },
  EVALUATION_COMPLETED: { ecosystem: "ZERO_G", referenceType: "INFERENCE_REQUEST_ID" },
  MILESTONE_APPROVED: { ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" },
  PAYMENT_RELEASED: { ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" },
  AGENT_PAYMENT_SETTLED: { ecosystem: "HEDERA", referenceType: "FACILITATOR_SETTLEMENT_ID" },
  AGENT_PAYMENT_DENIED: { ecosystem: "HEDERA", referenceType: "APPLICATION_EVENT_ID" },
};

/** Neutral wording: a summary says what was reported, never that it was verified. */
export const EVENT_SUMMARIES: Readonly<Record<ProofEventType, string>> = {
  AGREEMENT_ACCEPTED_CLIENT: "The client accepted the agreement.",
  AGREEMENT_ACCEPTED_FREELANCER: "The freelancer accepted the agreement.",
  MILESTONE_FUNDED: "Funding transaction for this milestone.",
  WORK_SUBMITTED: "Work submission transaction for this milestone.",
  EVALUATION_COMPLETED: "AI evaluation request (advisory only).",
  MILESTONE_APPROVED: "Approval transaction for this milestone.",
  PAYMENT_RELEASED: "Payment release transaction for this milestone.",
  AGENT_PAYMENT_SETTLED: "Agent payment settlement.",
  AGENT_PAYMENT_DENIED: "Agent payment denied by policy.",
};

const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
// Printable ASCII with no spaces.
const OPAQUE_REFERENCE = /^[\x21-\x7e]{1,256}$/;

/**
 * Checks a reference against its type and returns the form to store. Only a
 * transaction hash may have the shape of one, so types can never be mixed up.
 */
export const normalizeReference = (referenceType: ReferenceType, value: string): string => {
  if (referenceType === "BLOCKCHAIN_TRANSACTION_HASH") {
    if (!TRANSACTION_HASH.test(value)) {
      throw new ProofTrackError(
        "INVALID_REFERENCE",
        "A transaction hash must be 0x followed by 64 hex characters.",
      );
    }
    return value.toLowerCase();
  }
  if (TRANSACTION_HASH.test(value)) {
    throw new ProofTrackError(
      "INVALID_REFERENCE",
      `This value has the shape of a transaction hash, so it cannot be a ${referenceType}.`,
    );
  }
  if (!OPAQUE_REFERENCE.test(value)) {
    throw new ProofTrackError(
      "INVALID_REFERENCE",
      "A reference must be 1 to 256 printable characters with no spaces.",
    );
  }
  return value;
};
