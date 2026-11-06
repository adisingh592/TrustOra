import { createHash } from "node:crypto";
import { keccak256, stringToBytes } from "viem";

/** bytes32 key for the escrow contract: keccak256 of the milestone id's UTF-8 bytes. */
export const computeOnchainMilestoneId = (milestoneId: string) =>
  keccak256(stringToBytes(milestoneId));

/** JSON with object keys sorted at every level. Array order is kept. */
export const canonicalJson = (value: unknown): string => {
  const sortKeys = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, sortKeys(entry)]),
      );
    }
    return input;
  };
  return JSON.stringify(sortKeys(value));
};

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface MilestoneTerms {
  onchainMilestoneId: string;
  title: string;
  amountBaseUnits: string;
  /** ISO 8601 UTC. */
  deadline: string;
  criteria: string[];
}

export interface AgreementTerms {
  publicProjectId: string;
  title: string;
  description: string;
  clientWallet: string;
  freelancerWallet: string;
  arbiterWallet: string;
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number;
  milestones: MilestoneTerms[];
}

/**
 * The stored JSON and its hash. Milestones are ordered by their on-chain key, so
 * the order they arrive in cannot change the hash. The version number is not part
 * of the terms, so identical terms always hash the same.
 */
export const hashAgreementTerms = (terms: AgreementTerms) => {
  const criteriaJson = canonicalJson({
    ...terms,
    milestones: [...terms.milestones].sort((a, b) =>
      a.onchainMilestoneId < b.onchainMilestoneId ? -1 : 1,
    ),
  });
  return { criteriaJson, agreementHash: sha256Hex(criteriaJson) };
};
