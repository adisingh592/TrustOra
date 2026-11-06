import { describe, expect, it } from "vitest";
import { compareEvents, sortEvents } from "../src/ordering.js";
import type { StoredEvent } from "../src/types.js";

const makeEvent = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "event_1",
  publicProjectId: "TRU-PROJ-2026-0000001",
  milestoneId: null,
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:01.000Z"),
  ecosystem: "ARC",
  network: "Arc Testnet",
  chainId: 5042002,
  eventType: "MILESTONE_FUNDED",
  referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
  referenceValue: `0x${"a".repeat(64)}`,
  verificationStatus: "PENDING",
  statusReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  summary: "Funding transaction.",
  expected: {},
  ...over,
});

describe("compareEvents and sortEvents", () => {
  it("sorts by occurredAt ascending", () => {
    const e1 = makeEvent({ id: "e1", occurredAt: new Date("2026-01-01T00:00:00.000Z") });
    const e2 = makeEvent({ id: "e2", occurredAt: new Date("2026-01-02T00:00:00.000Z") });
    expect(compareEvents(e1, e2)).toBeLessThan(0);
    expect(compareEvents(e2, e1)).toBeGreaterThan(0);
    expect(sortEvents([e2, e1]).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("breaks ties with createdAt ascending when occurredAt is identical", () => {
    const e1 = makeEvent({
      id: "e1",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });
    const e2 = makeEvent({
      id: "e2",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:02.000Z"),
    });
    expect(compareEvents(e1, e2)).toBeLessThan(0);
    expect(sortEvents([e2, e1]).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("breaks ties with id lexicographically when both occurredAt and createdAt match", () => {
    const eA = makeEvent({
      id: "event_a",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });
    const eB = makeEvent({
      id: "event_b",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    });
    expect(compareEvents(eA, eB)).toBeLessThan(0);
    expect(compareEvents(eB, eA)).toBeGreaterThan(0);
    expect(sortEvents([eB, eA]).map((e) => e.id)).toEqual(["event_a", "event_b"]);
  });

  it("returns 0 for identical events", () => {
    const e = makeEvent();
    expect(compareEvents(e, e)).toBe(0);
  });
});
