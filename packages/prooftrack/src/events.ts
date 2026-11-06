import {
  ARC_TESTNET_CHAIN_ID,
  RecordProofEventInputSchema,
  type RecordProofEventInput,
} from "@trustora/shared";
import { ALLOWED_COMBINATIONS, normalizeReference } from "./rules.js";
import { type NaturalKey, ProofTrackError } from "./types.js";

export interface ValidatedEventInput {
  input: RecordProofEventInput;
  normalizedReference: string;
  naturalKey: NaturalKey;
}

/**
 * Validates raw event input against schema and domain rules:
 * - Checks schema conformity.
 * - Rejects mismatched ecosystem or reference type combinations.
 * - Enforces Arc chain ID.
 * - Normalizes reference value (e.g. lowercase hex for tx hashes).
 */
export const validateEventInput = (rawInput: unknown): ValidatedEventInput => {
  const parsed = RecordProofEventInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".");
    throw new ProofTrackError("INVALID_INPUT", `The event is not valid${field ? `: ${field}` : ""}.`);
  }
  const input = parsed.data;

  const allowed = ALLOWED_COMBINATIONS[input.eventType];
  if (input.ecosystem !== allowed.ecosystem || input.referenceType !== allowed.referenceType) {
    throw new ProofTrackError(
      "REFERENCE_TYPE_MISMATCH",
      `${input.eventType} must use ${allowed.ecosystem} and ${allowed.referenceType}.`,
    );
  }
  if (input.ecosystem === "ARC" && input.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new ProofTrackError("WRONG_CHAIN", `ARC events must use chain ID ${ARC_TESTNET_CHAIN_ID}.`);
  }

  const normalizedReference = normalizeReference(input.referenceType, input.referenceValue, input.ecosystem);
  const naturalKey: NaturalKey = {
    referenceType: input.referenceType,
    referenceValue: normalizedReference,
    eventType: input.eventType,
  };

  return { input, normalizedReference, naturalKey };
};
