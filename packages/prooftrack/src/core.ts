import {
  ARC_TESTNET_CHAIN_ID,
  type Ecosystem,
  RecordProofEventInputSchema,
  type RecordProofEventInput,
  type VerificationStatus,
} from "@trustora/shared";
import { ALLOWED_COMBINATIONS, EVENT_SUMMARIES, normalizeReference } from "./rules.js";
import { compareEvents } from "./ordering.js";
import {
  DuplicateEventError,
  type EventStore,
  ProofTrackError,
  type StoredEvent,
  type TimelineFilter,
  type TimelineItem,
  type VerificationUpdate,
  type VerifierKey,
  type VerifierResult,
  type Verifiers,
} from "./types.js";

export const DEFAULT_VERIFY_TIMEOUT_MS = 8_000;
export const DEFAULT_VERIFY_CONCURRENCY = 4;

export const NO_VERIFIER_REASON = "No independent check available yet.";
export const CHECK_FAILED_REASON = "The check could not be completed.";
export const CHECK_TIMED_OUT_REASON = "The check timed out.";
const MAX_REASON_LENGTH = 200;

export const verifierKey = (event: Pick<StoredEvent, "ecosystem" | "referenceType">): VerifierKey =>
  `${event.ecosystem}:${event.referenceType}`;

export interface ProofTrackOptions {
  store: EventStore;
  /**
   * Explorer URL templates with a {reference} placeholder. Leave empty until a
   * template is confirmed: without one, explorerUrl is always null.
   */
  explorerTemplates?: Partial<Record<Ecosystem, string>>;
  now?: () => Date;
  timeoutMs?: number;
  concurrency?: number;
}

export interface ProofTrack {
  recordEvent(input: unknown): Promise<StoredEvent>;
  getTimeline(publicProjectId: string, filter?: TimelineFilter): Promise<TimelineItem[]>;
  verifyEvent(eventId: string, verifiers: Verifiers): Promise<StoredEvent>;
  verifyProject(publicProjectId: string, verifiers: Verifiers): Promise<StoredEvent[]>;
}

const compareEvents = (a: StoredEvent, b: StoredEvent) =>
  a.occurredAt.getTime() - b.occurredAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One short line, so a verifier's reason cannot carry a stack trace. */
const cleanReason = (reason: unknown, fallback: string) => {
  if (typeof reason !== "string") return fallback;
  const line = reason.split(/[\r\n]/, 1)[0]!.trim();
  return line ? line.slice(0, MAX_REASON_LENGTH) : fallback;
};

const validDate = (value: unknown, fallback: Date) =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;

/**
 * How a check changes an event's status. The latest check always wins:
 * - MATCH: VERIFIED.
 * - MISMATCH: FAILED, including for an event that was VERIFIED.
 * - Anything else: PENDING, including for an event that was VERIFIED, because a
 *   status must only claim what the latest check could confirm. Nothing but an
 *   exact MATCH can ever produce VERIFIED.
 */
const toUpdate = (result: VerifierResult, now: Date): VerificationUpdate => {
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
  return update("PENDING", cleanReason(result.reason, CHECK_FAILED_REASON), null);
};

export const createProofTrack = (options: ProofTrackOptions): ProofTrack => {
  const { store, explorerTemplates = {} } = options;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_VERIFY_CONCURRENCY);

  const explorerUrlFor = (event: StoredEvent) => {
    const template = explorerTemplates[event.ecosystem];
    return template
      ? template.replaceAll("{reference}", encodeURIComponent(event.referenceValue))
      : null;
  };

  const toTimelineItem = (event: StoredEvent): TimelineItem => ({
    id: event.id,
    type: event.eventType,
    ecosystem: event.ecosystem,
    network: event.network,
    referenceType: event.referenceType,
    reference: event.referenceValue,
    status: event.verificationStatus,
    statusReason: event.statusReason,
    lastCheckedAt: event.lastCheckedAt?.toISOString() ?? null,
    occurredAt: event.occurredAt.toISOString(),
    explorerUrl: explorerUrlFor(event),
    summary: event.summary,
  });

  const existingFor = (input: RecordProofEventInput, existing: StoredEvent) => {
    if (existing.publicProjectId !== input.publicProjectId) {
      // Never returns the other project's event, and one proof cannot serve two projects.
      throw new ProofTrackError(
        "REFERENCE_ALREADY_USED",
        "This reference is already recorded for a different project.",
      );
    }
    return existing;
  };

  const recordEvent: ProofTrack["recordEvent"] = async (rawInput) => {
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

    const referenceValue = normalizeReference(input.referenceType, input.referenceValue);
    const key = { referenceType: input.referenceType, referenceValue, eventType: input.eventType };

    const existing = await store.findByNaturalKey(key);
    if (existing) return existingFor(input, existing);

    try {
      return await store.insert({
        publicProjectId: input.publicProjectId,
        milestoneId: input.milestoneId ?? null,
        occurredAt: new Date(input.occurredAt),
        createdAt: now(),
        ecosystem: input.ecosystem,
        network: input.network,
        chainId: input.chainId ?? null,
        eventType: input.eventType,
        referenceType: input.referenceType,
        referenceValue,
        verificationStatus: "PENDING",
        statusReason: null,
        lastCheckedAt: null,
        verifiedAt: null,
        summary: EVENT_SUMMARIES[input.eventType],
        expected: input.expected,
      });
    } catch (error) {
      if (!(error instanceof DuplicateEventError)) throw error;
      // Another request recorded it first.
      const winner = await store.findByNaturalKey(key);
      if (!winner) throw error;
      return existingFor(input, winner);
    }
  };

  const runVerifier = async (event: StoredEvent, verifiers: Verifiers): Promise<VerifierResult> => {
    const verifier = verifiers.get(verifierKey(event));
    if (!verifier) {
      return { outcome: "UNAVAILABLE", reason: NO_VERIFIER_REASON, checkedAt: now() };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<VerifierResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ outcome: "UNAVAILABLE", reason: CHECK_TIMED_OUT_REASON, checkedAt: now() }),
        timeoutMs,
      );
    });
    try {
      const result = await Promise.race([verifier(event), timeout]);
      // A verifier that answers nothing has not checked anything.
      return result ?? { outcome: "UNAVAILABLE", reason: CHECK_FAILED_REASON, checkedAt: now() };
    } catch {
      // The error itself is never stored: it could contain internal details.
      return { outcome: "UNAVAILABLE", reason: CHECK_FAILED_REASON, checkedAt: now() };
    } finally {
      clearTimeout(timer);
    }
  };

  const verifyStored = async (event: StoredEvent, verifiers: Verifiers) =>
    store.updateVerification(event.id, toUpdate(await runVerifier(event, verifiers), now()));

  return {
    recordEvent,

    async getTimeline(publicProjectId) {
      const events = await store.listByProject(publicProjectId);
      return [...events].sort(compareEvents).map(toTimelineItem);
    },

    async verifyEvent(eventId, verifiers) {
      const event = await store.getById(eventId);
      if (!event) throw new ProofTrackError("EVENT_NOT_FOUND", "This event was not found.");
      return verifyStored(event, verifiers);
    },

    async verifyProject(publicProjectId, verifiers) {
      const events = await store.listByProject(publicProjectId);
      const results: StoredEvent[] = [];
      let next = 0;
      const worker = async () => {
        while (next < events.length) {
          const index = next;
          next += 1;
          results[index] = await verifyStored(events[index]!, verifiers);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, events.length) }, worker));
      return results;
    },
  };
};
