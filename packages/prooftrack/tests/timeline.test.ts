import { describe, expect, it } from "vitest";
import { buildTimeline, toTimelineItem } from "../src/timeline.js";
import type { StoredEvent } from "../src/types.js";

const makeEvent = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "event_1",
  publicProjectId: "TRU-PROJ-2026-0000001",
  milestoneId: "milestone_1",
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
  expected: { amountBaseUnits: "50000000" },
  ...over,
});

describe("toTimelineItem and buildTimeline", () => {
  it("formats a stored event into a sanitized timeline item with exact allowed fields", () => {
    const event = makeEvent({
      lastCheckedAt: new Date("2026-01-02T00:00:00.000Z"),
      statusReason: "Checked OK",
    });
    const item = toTimelineItem(event);
    expect(item).toEqual({
      id: "event_1",
      type: "MILESTONE_FUNDED",
      ecosystem: "ARC",
      network: "Arc Testnet",
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      reference: `0x${"a".repeat(64)}`,
      status: "PENDING",
      statusReason: "Checked OK",
      lastCheckedAt: "2026-01-02T00:00:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      explorerUrl: null,
      summary: "Funding transaction.",
    });
    // Never leaks internal expected values
    expect(JSON.stringify(item)).not.toContain("50000000");
  });

  it("buildTimeline returns empty array for empty events list", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it("buildTimeline filters by milestoneId when provided", () => {
    const e1 = makeEvent({ id: "e1", milestoneId: "m1", occurredAt: new Date("2026-01-01T00:00:00.000Z") });
    const e2 = makeEvent({ id: "e2", milestoneId: "m2", occurredAt: new Date("2026-01-02T00:00:00.000Z") });
    const e3 = makeEvent({ id: "e3", milestoneId: "m1", occurredAt: new Date("2026-01-03T00:00:00.000Z") });

    const all = buildTimeline([e1, e2, e3]);
    expect(all.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);

    const m1Only = buildTimeline([e1, e2, e3], { milestoneId: "m1" });
    expect(m1Only.map((item) => item.id)).toEqual(["e1", "e3"]);

    const m2Only = buildTimeline([e1, e2, e3], { milestoneId: "m2" });
    expect(m2Only.map((item) => item.id)).toEqual(["e2"]);

    const nonExistent = buildTimeline([e1, e2, e3], { milestoneId: "m999" });
    expect(nonExistent).toEqual([]);
  });

  it("applies explorer templates correctly", () => {
    const event = makeEvent({ referenceValue: "0x1234abcd" });
    const templates = { ARC: "https://explorer.test/tx/{reference}" };
    const item = toTimelineItem(event, templates);
    expect(item.explorerUrl).toBe("https://explorer.test/tx/0x1234abcd");
  });
});
