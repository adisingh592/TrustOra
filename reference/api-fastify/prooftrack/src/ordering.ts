import type { StoredEvent } from "./types.js";

/**
 * Deterministic comparator for ProofTrack events.
 *
 * Ordering rules:
 * 1. By `occurredAt` ascending (when the real-world action happened).
 * 2. Break ties by `createdAt` ascending (when the server recorded it).
 * 3. Break remaining ties by `id` ascending (lexicographical order of unique ID).
 *
 * This guarantees stable, deterministic ordering even when timestamps match.
 */
export const compareEvents = (a: StoredEvent, b: StoredEvent): number =>
  a.occurredAt.getTime() - b.occurredAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Sorts a list of stored events deterministically. Does not mutate the input array. */
export const sortEvents = (events: readonly StoredEvent[]): StoredEvent[] =>
  [...events].sort(compareEvents);
