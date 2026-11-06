import { createHash } from "node:crypto";

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

export interface EventDigestInput {
  projectId: string;
  type: string;
  ecosystem: string;
  referenceType: string;
  reference: string;
  /** ISO 8601 UTC. */
  occurredAt: string;
}

/**
 * SHA-256 hex of the canonical JSON of exactly these six fields. Fields are picked
 * by name, so anything else on the object cannot change the digest or reach it.
 */
export const computeEventDigest = (event: EventDigestInput): string => {
  const { projectId, type, ecosystem, referenceType, reference, occurredAt } = event;
  return createHash("sha256")
    .update(canonicalJson({ projectId, type, ecosystem, referenceType, reference, occurredAt }), "utf8")
    .digest("hex");
};
