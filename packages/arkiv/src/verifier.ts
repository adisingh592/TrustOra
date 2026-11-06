import type { StoredEvent, Verifier, VerifierResult } from "@trustora/prooftrack";
import { type AnchorAdapter, AnchorError, type AnchorReadResult } from "@trustora/shared";
import { digestOfStoredEvent } from "./payload.js";

export const ANCHOR_UNREADABLE_REASON = "Anchor expired or not readable right now.";

export interface ArkivAnchorVerifierOptions {
  /** Undefined when Arkiv is disabled: the event then stays PENDING. */
  adapter: AnchorAdapter | undefined;
  /** Loads the anchored event from OUR database, never from Arkiv. */
  getEvent: (id: string) => Promise<StoredEvent | null>;
  now?: () => Date;
}

/**
 * Re-reads the entity from Arkiv and compares it with our database. MATCH needs all
 * of: our anchor address as owner, the digest recomputed from our own event, and the
 * same project. Anyone can write under our schema tag, so nothing else is trusted.
 * Not being able to read an anchor is not evidence against it: that stays PENDING.
 */
export const createArkivAnchorVerifier = (options: ArkivAnchorVerifierOptions): Verifier => {
  const { adapter, getEvent } = options;
  const now = options.now ?? (() => new Date());

  return async (event) => {
    const result = (outcome: VerifierResult["outcome"], reason?: string): VerifierResult => ({
      outcome,
      ...(reason ? { reason } : {}),
      checkedAt: now(),
    });
    const unreadable = () => result("UNAVAILABLE", ANCHOR_UNREADABLE_REASON);

    if (!adapter) return unreadable();

    const sourceEventId = event.expected.sourceEventId;
    const source = sourceEventId ? await getEvent(sourceEventId) : null;
    if (!source) return result("UNAVAILABLE", "The anchored event could not be found.");

    let read: AnchorReadResult;
    try {
      read = await adapter.readAnchor(event.referenceValue);
    } catch (error) {
      // An entity at our key that does not fit our schema is real evidence of a problem.
      if (error instanceof AnchorError && error.code === "INVALID_ENTITY") {
        return result("MISMATCH", "The anchor's content does not match our records.");
      }
      return unreadable();
    }
    if (read.status !== "found") return unreadable();

    if (read.ownerAddress.toLowerCase() !== adapter.anchorAddress.toLowerCase()) {
      return result("MISMATCH", "The anchor was not written by our anchor address.");
    }
    if (
      read.payload.projectId !== event.publicProjectId ||
      source.publicProjectId !== event.publicProjectId
    ) {
      return result("MISMATCH", "The anchor is for a different project.");
    }
    if (read.payload.eventDigest !== digestOfStoredEvent(source)) {
      return result("MISMATCH", "The anchor's digest does not match our records.");
    }
    return result("MATCH");
  };
};
