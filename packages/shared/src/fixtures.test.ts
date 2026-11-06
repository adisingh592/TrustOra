import { describe, expect, it } from "vitest";
import { FIXTURE_PROJECT, FIXTURE_PROOF_EVENTS } from "./fixtures.js";
import { PROOF_EVENT_TYPES } from "./proofevent.js";
import { ProofEventSchema } from "./schemas.js";

const fixtures = Object.values(FIXTURE_PROOF_EVENTS);

describe("fixtures", () => {
  it("labels the sample project as a fixture", () => {
    expect(FIXTURE_PROJECT.isFixture).toBe(true);
    expect(FIXTURE_PROJECT.data.publicProjectId).toBe("TRU-PROJ-2026-0001042");
  });

  it("has exactly one ProofEvent per event type", () => {
    expect(fixtures.map((f) => f.data.eventType).sort()).toEqual(
      [...PROOF_EVENT_TYPES].sort(),
    );
  });

  it.each(fixtures.map((f) => [f.data.eventType, f] as const))(
    "%s passes the schema and cannot read as real proof",
    (_eventType, f) => {
      expect(f.isFixture).toBe(true);
      expect(f.data.id.startsWith("FIXTURE_")).toBe(true);
      expect(f.data.summary.startsWith("FIXTURE:")).toBe(true);
      expect(f.data.verificationStatus).toBe("PENDING");
      expect(f.data.verifiedAt).toBeUndefined();
      expect(f.data.explorerUrl).toBeUndefined();
      expect(ProofEventSchema.safeParse(f.data).success).toBe(true);
    },
  );
});
