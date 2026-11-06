import type { AnchorPayload } from "./schemas.js";

export type AnchorErrorCode =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_FUNDS"
  | "INVALID_KEY"
  | "INVALID_PAYLOAD"
  | "INVALID_ENTITY"
  | "UNAVAILABLE";

const ANCHOR_ERROR_MESSAGES: Record<AnchorErrorCode, string> = {
  RATE_LIMITED: "The anchor service is rate limiting requests.",
  TIMEOUT: "The anchor service did not answer in time.",
  UNAUTHORIZED: "The anchor service refused our credentials.",
  INSUFFICIENT_FUNDS: "The anchor account has no funds for this write.",
  INVALID_KEY: "This is not a valid anchor key.",
  INVALID_PAYLOAD: "This anchor content is not valid.",
  INVALID_ENTITY: "The entity at this key does not fit the anchor schema.",
  UNAVAILABLE: "The anchor service is not available right now.",
};

/** Holds a code and a fixed message only, so it cannot carry a key or a URL. */
export class AnchorError extends Error {
  constructor(readonly code: AnchorErrorCode) {
    super(ANCHOR_ERROR_MESSAGES[code]);
    this.name = "AnchorError";
  }
}

export interface PublishedAnchor {
  /** A STORAGE_REFERENCE: not a transaction hash and not an inference request ID. */
  entityKey: string;
  /** ISO 8601 UTC estimate. Anchors expire. */
  expiresAt: string;
}

export type AnchorReadResult =
  | {
      status: "found";
      ownerAddress: string;
      payload: AnchorPayload;
      /** ISO 8601 UTC estimate, or null when it could not be worked out. */
      expiresAt: string | null;
    }
  | { status: "not_found" }
  | { status: "expired" };

export interface AnchorAdapter {
  /** The only owner whose anchors are accepted. Lowercase. */
  readonly anchorAddress: string;
  readonly network: string;
  publishAnchor(payload: AnchorPayload): Promise<PublishedAnchor>;
  readAnchor(entityKey: string): Promise<AnchorReadResult>;
}
