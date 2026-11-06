import { FIXTURE_PROOF_EVENTS, PROOF_EVENT_TYPES, type ProofEventType } from "@trustora/shared";
import { describe, expect, it, vi } from "vitest";
import { createProofTrack, NO_VERIFIER_REASON, type ProofTrackOptions, verifierKey } from "./core.js";
import { MOCK_InMemoryEventStore } from "./mocks.js";
import { ALLOWED_COMBINATIONS } from "./rules.js";
import { type ProofTrackErrorCode, ProofTrackError, type StoredEvent, type Verifier, type VerifierKey } from "./types.js";

// All values are fake. No database or network is used here.
const PROJECT = "TRU-PROJ-2026-0000001";
const OTHER_PROJECT = "TRU-PROJ-2026-0000002";
const FIXTURE_HASH = `0x${"a".repeat(64)}`;
const ARC_KEY = verifierKey({ ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" });
const ZERO_G_KEY = verifierKey({ ecosystem: "ZERO_G", referenceType: "INFERENCE_REQUEST_ID" });

const setup = (options: Partial<ProofTrackOptions> = {}) => {
  const store = new MOCK_InMemoryEventStore();
  return { store, track: createProofTrack({ store, ...options }) };
};

const referenceFor = (type: ProofEventType, unique = "1") =>
  ALLOWED_COMBINATIONS[type].referenceType === "BLOCKCHAIN_TRANSACTION_HASH"
    ? `0x${unique.padStart(64, "a")}`
    : `FIXTURE_ref_${unique}`;

const inputFor = (eventType: ProofEventType, over: object = {}) => {
  const { ecosystem, referenceType } = ALLOWED_COMBINATIONS[eventType];
  return {
    publicProjectId: PROJECT,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ecosystem,
    network: ecosystem === "ARC" ? "Arc Testnet" : "FIXTURE_NETWORK",
    ...(ecosystem === "ARC" ? { chainId: 5042002 } : {}),
    eventType,
    referenceType,
    referenceValue: referenceFor(eventType),
    ...over,
  };
};

const expectError = async (attempt: Promise<unknown>, code: ProofTrackErrorCode) => {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProofTrackError);
  expect((error as ProofTrackError).code).toBe(code);
};

const registered = (verifier: Verifier, key: VerifierKey = ARC_KEY) => new Map([[key, verifier]]);
const answering = (outcome: "MATCH" | "MISMATCH" | "UNAVAILABLE", reason?: string): Verifier =>
  async () => ({ outcome, ...(reason ? { reason } : {}), checkedAt: new Date("2026-02-01T00:00:00.000Z") });

const fundedEvent = (track: ReturnType<typeof setup>["track"]) => track.recordEvent(inputFor("MILESTONE_FUNDED"));

describe("recordEvent: combinations", () => {
  it("has a rule for every event type in shared", () => {
    expect(Object.keys(ALLOWED_COMBINATIONS).sort()).toEqual([...PROOF_EVENT_TYPES].sort());
  });

  it("enforces the specified rows", () => {
    const arcHash = { ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" };
    expect(ALLOWED_COMBINATIONS.MILESTONE_FUNDED).toEqual(arcHash);
    expect(ALLOWED_COMBINATIONS.WORK_SUBMITTED).toEqual(arcHash);
    expect(ALLOWED_COMBINATIONS.MILESTONE_APPROVED).toEqual(arcHash);
    expect(ALLOWED_COMBINATIONS.PAYMENT_RELEASED).toEqual(arcHash);
    expect(ALLOWED_COMBINATIONS.EVALUATION_COMPLETED).toEqual({
      ecosystem: "ZERO_G",
      referenceType: "INFERENCE_REQUEST_ID",
    });
  });

  it.each([...PROOF_EVENT_TYPES])("accepts the valid combination for %s", async (eventType) => {
    const { track } = setup();
    const event = await track.recordEvent(inputFor(eventType));
    expect(event.eventType).toBe(eventType);
  });

  it.each([...PROOF_EVENT_TYPES])("rejects the wrong ecosystem for %s", async (eventType) => {
    const { track } = setup();
    const wrong = ALLOWED_COMBINATIONS[eventType].ecosystem === "ARC" ? "HEDERA" : "ARC";
    await expectError(
      track.recordEvent(inputFor(eventType, { ecosystem: wrong, chainId: 5042002 })),
      "REFERENCE_TYPE_MISMATCH",
    );
  });

  it.each([...PROOF_EVENT_TYPES])("rejects the wrong reference type for %s", async (eventType) => {
    const { track } = setup();
    const wrong =
      ALLOWED_COMBINATIONS[eventType].referenceType === "STORAGE_REFERENCE"
        ? "APPLICATION_EVENT_ID"
        : "STORAGE_REFERENCE";
    await expectError(track.recordEvent(inputFor(eventType, { referenceType: wrong })), "REFERENCE_TYPE_MISMATCH");
  });

  it.each(Object.values(FIXTURE_PROOF_EVENTS).map((f) => [f.data.eventType, f.data] as const))(
    "the shared fixture for %s follows the table",
    (eventType, data) => {
      const rule = ALLOWED_COMBINATIONS[eventType as ProofEventType];
      expect({ ecosystem: data.ecosystem, referenceType: data.referenceType }).toEqual(rule);
    },
  );

  it.each([[1], [undefined]])("rejects an ARC event not on Arc Testnet: chain %s", async (chainId) => {
    const { track } = setup();
    await expectError(track.recordEvent(inputFor("MILESTONE_FUNDED", { chainId })), "WRONG_CHAIN");
  });

  it.each([
    ["no input", undefined],
    ["unknown event type", { ...inputFor("MILESTONE_FUNDED"), eventType: "MADE_UP" }],
    ["bad project ID", inputFor("MILESTONE_FUNDED", { publicProjectId: "x" })],
    ["a caller-set status", inputFor("MILESTONE_FUNDED", { verificationStatus: "VERIFIED" })],
    ["a file path in expected", inputFor("MILESTONE_FUNDED", { expected: { privateFilePath: "/x" } })],
    ["a number amount in expected", inputFor("MILESTONE_FUNDED", { expected: { amountBaseUnits: 5 } })],
  ])("rejects %s", async (_label, input) => {
    const { track } = setup();
    await expectError(track.recordEvent(input), "INVALID_INPUT");
  });
});

describe("recordEvent: reference formats (R1)", () => {
  it.each([
    ["0x and 64 hex", FIXTURE_HASH],
    ["0x and 64 uppercase hex", `0x${"A".repeat(64)}`],
  ])("rejects a transaction-hash shape as INFERENCE_REQUEST_ID: %s", async (_label, referenceValue) => {
    const { track } = setup();
    await expectError(track.recordEvent(inputFor("EVALUATION_COMPLETED", { referenceValue })), "INVALID_REFERENCE");
  });

  it.each(["AGREEMENT_ACCEPTED_CLIENT", "AGENT_PAYMENT_SETTLED", "AGENT_PAYMENT_DENIED"] as const)(
    "rejects a transaction-hash shape on %s",
    async (eventType) => {
      const { track } = setup();
      await expectError(track.recordEvent(inputFor(eventType, { referenceValue: FIXTURE_HASH })), "INVALID_REFERENCE");
    },
  );

  it.each([
    ["too short", "0x1234"],
    ["no 0x", "a".repeat(64)],
    ["not hex", `0x${"g".repeat(64)}`],
    ["too long", `0x${"a".repeat(65)}`],
    ["a request ID", "FIXTURE_request_1"],
    ["empty", ""],
  ])("rejects a malformed transaction hash: %s", async (_label, referenceValue) => {
    const { track } = setup();
    await expectError(track.recordEvent(inputFor("MILESTONE_FUNDED", { referenceValue })), "INVALID_REFERENCE");
  });

  it.each([
    ["empty", ""],
    ["too long", "a".repeat(257)],
    ["spaces", "a b"],
    ["a newline", "a\nb"],
  ])("rejects a bad inference request ID: %s", async (_label, referenceValue) => {
    const { track } = setup();
    await expectError(track.recordEvent(inputFor("EVALUATION_COMPLETED", { referenceValue })), "INVALID_REFERENCE");
  });

  it("accepts an inference request ID at the maximum length", async () => {
    const { track } = setup();
    const event = await track.recordEvent(inputFor("EVALUATION_COMPLETED", { referenceValue: "a".repeat(256) }));
    expect(event.referenceValue).toHaveLength(256);
  });

  it("stores a transaction hash lowercase", async () => {
    const { track } = setup();
    const event = await track.recordEvent(inputFor("MILESTONE_FUNDED", { referenceValue: `0x${"AB".repeat(32)}` }));
    expect(event.referenceValue).toBe(`0x${"ab".repeat(32)}`);
  });
});

describe("recordEvent: state", () => {
  it("starts PENDING, never checked, with times in UTC", async () => {
    const { track } = setup({ now: () => new Date("2026-03-01T00:00:00.000Z") });
    const event = await track.recordEvent(inputFor("MILESTONE_FUNDED", { occurredAt: "2026-01-01T05:30:00Z" }));
    expect(event.verificationStatus).toBe("PENDING");
    expect(event.lastCheckedAt).toBeNull();
    expect(event.verifiedAt).toBeNull();
    expect(event.statusReason).toBeNull();
    expect(event.occurredAt.toISOString()).toBe("2026-01-01T05:30:00.000Z");
    expect(event.createdAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("normalises expected", async () => {
    const { track } = setup();
    const event = await track.recordEvent(
      inputFor("MILESTONE_FUNDED", {
        expected: { agreementHash: "A".repeat(64), amountBaseUnits: "50000000" },
      }),
    );
    expect(event.expected).toEqual({ agreementHash: "a".repeat(64), amountBaseUnits: "50000000" });
  });

  it("re-recording returns the same event, matching a hash in any case", async () => {
    const { track, store } = setup();
    const first = await track.recordEvent(inputFor("MILESTONE_FUNDED", { referenceValue: `0x${"ab".repeat(32)}` }));
    const again = await track.recordEvent(inputFor("MILESTONE_FUNDED", { referenceValue: `0x${"AB".repeat(32)}` }));
    expect(again.id).toBe(first.id);
    expect(store.events.size).toBe(1);
  });

  it("re-recording does not reset an event's status or overwrite expected", async () => {
    const { track } = setup();
    const first = await track.recordEvent(inputFor("MILESTONE_FUNDED", { expected: { amountBaseUnits: "1" } }));
    await track.verifyEvent(first.id, registered(answering("MATCH")));
    const again = await track.recordEvent(inputFor("MILESTONE_FUNDED", { expected: { amountBaseUnits: "2" } }));
    expect(again.verificationStatus).toBe("VERIFIED");
    expect(again.expected).toEqual({ amountBaseUnits: "1" });
  });

  it("parallel records make one event", async () => {
    const { track, store } = setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => fundedEvent(track)));
    expect(new Set(results.map((e) => e.id)).size).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it("a lost insert race returns the winner instead of failing", async () => {
    const { store, track } = setup();
    const find = vi.spyOn(store, "findByNaturalKey");
    const winner = await fundedEvent(track);
    find.mockResolvedValueOnce(null);
    expect((await fundedEvent(track)).id).toBe(winner.id);
  });

  it("refuses a reference already used by another project and does not reveal it", async () => {
    const { track } = setup();
    const first = await fundedEvent(track);
    const attempt = track.recordEvent(inputFor("MILESTONE_FUNDED", { publicProjectId: OTHER_PROJECT }));
    await expectError(attempt, "REFERENCE_ALREADY_USED");
    const message = await attempt.catch((e: Error) => e.message);
    expect(message).not.toContain(PROJECT);
    expect(message).not.toContain(first.id);
  });

  it("allows the same reference on a different event type", async () => {
    const { track } = setup();
    const funded = await track.recordEvent(inputFor("MILESTONE_FUNDED"));
    const released = await track.recordEvent(inputFor("PAYMENT_RELEASED"));
    expect(released.id).not.toBe(funded.id);
  });
});

describe("getTimeline", () => {
  it("orders by occurredAt, then createdAt, then id", async () => {
    let tick = 0;
    const times = ["2026-03-01T00:00:02.000Z", "2026-03-01T00:00:01.000Z", "2026-03-01T00:00:01.000Z", "2026-03-01T00:00:00.000Z"];
    const { track, store } = setup({ now: () => new Date(times[tick++]!) });
    const same = "2026-01-01T00:00:00.000Z";
    const late = await track.recordEvent(inputFor("PAYMENT_RELEASED", { occurredAt: "2026-02-01T00:00:00.000Z" }));
    const a = await track.recordEvent(inputFor("MILESTONE_FUNDED", { occurredAt: same }));
    const b = await track.recordEvent(inputFor("WORK_SUBMITTED", { occurredAt: same }));
    const early = await track.recordEvent(inputFor("MILESTONE_APPROVED", { occurredAt: same }));

    const expected = [early.id, a.id, b.id, late.id];
    expect((await track.getTimeline(PROJECT)).map((item) => item.id)).toEqual(expected);

    // Whatever order the store returns, the timeline is the same.
    const spy = vi.spyOn(store, "listByProject");
    spy.mockResolvedValueOnce([late, b, early, a]);
    expect((await track.getTimeline(PROJECT)).map((item) => item.id)).toEqual(expected);
    spy.mockResolvedValueOnce([a, early, late, b]);
    expect((await track.getTimeline(PROJECT)).map((item) => item.id)).toEqual(expected);
  });

  it("returns exactly the documented fields, and never expected", async () => {
    const { track } = setup();
    await track.recordEvent(inputFor("MILESTONE_FUNDED", { expected: { amountBaseUnits: "50000000", agreementHash: "c".repeat(64) } }));
    const [item] = await track.getTimeline(PROJECT);
    expect(Object.keys(item!).sort()).toEqual(
      ["ecosystem", "explorerUrl", "id", "lastCheckedAt", "network", "occurredAt", "reference", "referenceType", "status", "statusReason", "summary", "type"].sort(),
    );
    expect(JSON.stringify(item)).not.toContain("50000000");
    expect(JSON.stringify(item)).not.toContain("c".repeat(64));
  });

  it("includes only this project's events", async () => {
    const { track } = setup();
    await fundedEvent(track);
    expect(await track.getTimeline(OTHER_PROJECT)).toEqual([]);
  });

  it("no summary claims a step was verified", () => {
    return Promise.all(
      PROOF_EVENT_TYPES.map(async (eventType) => {
        const { track } = setup();
        const event = await track.recordEvent(inputFor(eventType));
        expect(event.summary).not.toMatch(/verified|confirmed|proven/i);
        expect(event.summary.length).toBeGreaterThan(0);
      }),
    );
  });

  describe("explorerUrl (R5)", () => {
    it("is null by default", async () => {
      const { track } = setup();
      await fundedEvent(track);
      expect((await track.getTimeline(PROJECT))[0]!.explorerUrl).toBeNull();
    });

    it("is set only when that ecosystem has a template", async () => {
      const { track } = setup({ explorerTemplates: { ARC: "https://FIXTURE.invalid/tx/{reference}" } });
      await fundedEvent(track);
      await track.recordEvent(inputFor("EVALUATION_COMPLETED", { occurredAt: "2026-01-02T00:00:00.000Z" }));
      const [arc, zeroG] = await track.getTimeline(PROJECT);
      expect(arc!.explorerUrl).toBe(`https://FIXTURE.invalid/tx/${referenceFor("MILESTONE_FUNDED")}`);
      expect(zeroG!.explorerUrl).toBeNull();
    });

    it("escapes the reference", async () => {
      const { track } = setup({ explorerTemplates: { ZERO_G: "https://FIXTURE.invalid/{reference}" } });
      await track.recordEvent(inputFor("EVALUATION_COMPLETED", { referenceValue: "a/../b?x=1" }));
      expect((await track.getTimeline(PROJECT))[0]!.explorerUrl).toBe("https://FIXTURE.invalid/a%2F..%2Fb%3Fx%3D1");
    });
  });
});

describe("verifyEvent", () => {
  const CHECKED = new Date("2026-02-01T00:00:00.000Z");

  it("MATCH becomes VERIFIED", async () => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, registered(answering("MATCH")));
    expect(result.verificationStatus).toBe("VERIFIED");
    expect(result.statusReason).toBeNull();
    expect(result.lastCheckedAt).toEqual(CHECKED);
    expect(result.verifiedAt).toEqual(CHECKED);
  });

  it("MISMATCH becomes FAILED with the reason", async () => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, registered(answering("MISMATCH", "The amount does not match.")));
    expect(result.verificationStatus).toBe("FAILED");
    expect(result.statusReason).toBe("The amount does not match.");
    expect(result.lastCheckedAt).toEqual(CHECKED);
    expect(result.verifiedAt).toBeNull();
  });

  it("UNAVAILABLE stays PENDING with a reason", async () => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, registered(answering("UNAVAILABLE", "The RPC is down.")));
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.statusReason).toBe("The RPC is down.");
    expect(result.lastCheckedAt).toEqual(CHECKED);
  });

  it("a thrown error stays PENDING and its text is not exposed", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { track } = setup({ now: () => now });
    const event = await fundedEvent(track);
    const secret = "postgres://user:FIXTURE_password@internal-host at /srv/app/index.js:42";
    const result = await track.verifyEvent(
      event.id,
      registered(async () => {
        throw new Error(secret);
      }),
    );
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.statusReason).toBe("The check could not be completed.");
    expect(JSON.stringify(result)).not.toContain("FIXTURE_password");
    expect(result.lastCheckedAt).toEqual(now);
    const timeline = JSON.stringify(await track.getTimeline(PROJECT));
    expect(timeline).not.toContain("FIXTURE_password");
    expect(timeline).not.toContain("index.js");
  });

  it("a verifier that throws before returning a promise stays PENDING", async () => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(
      event.id,
      registered((() => {
        throw new Error("sync failure");
      }) as Verifier),
    );
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.statusReason).toBe("The check could not be completed.");
  });

  it("a timeout stays PENDING", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { track } = setup({ timeoutMs: 10, now: () => now });
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, registered(() => new Promise(() => undefined)));
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.statusReason).toBe("The check timed out.");
    expect(result.lastCheckedAt).toEqual(now);
  });

  it("a verifier that answers MATCH after the timeout cannot verify the event", async () => {
    const { track, store } = setup({ timeoutMs: 5 });
    const event = await fundedEvent(track);
    const slow: Verifier = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ outcome: "MATCH", checkedAt: new Date() }), 40),
      );
    await track.verifyEvent(event.id, registered(slow));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await store.getById(event.id))!.verificationStatus).toBe("PENDING");
  });

  it("defaults to an 8 second timeout", async () => {
    vi.useFakeTimers();
    try {
      const { track } = setup();
      const event = await fundedEvent(track);
      const pending = track.verifyEvent(event.id, registered(() => new Promise(() => undefined)));
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).statusReason).toBe("The check timed out.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("no verifier registered stays PENDING, and lastCheckedAt updates", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { track } = setup({ now: () => now });
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, new Map());
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.statusReason).toBe(NO_VERIFIER_REASON);
    expect(result.lastCheckedAt).toEqual(now);
  });

  it("uses the verifier for this ecosystem and reference type only", async () => {
    const { track } = setup();
    const event = await track.recordEvent(inputFor("EVALUATION_COMPLETED"));
    const result = await track.verifyEvent(event.id, registered(answering("MATCH"), ARC_KEY));
    expect(result.verificationStatus).toBe("PENDING");
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["an unknown outcome", { outcome: "PROBABLY", checkedAt: new Date() }],
    ["lowercase match", { outcome: "match", checkedAt: new Date() }],
    ["true", true],
  ])("anything but an exact MATCH never verifies: %s", async (_label, answer) => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const result = await track.verifyEvent(event.id, registered((async () => answer) as Verifier));
    expect(result.verificationStatus).toBe("PENDING");
    expect(result.verifiedAt).toBeNull();
  });

  it("a multi-line reason keeps only one short line", async () => {
    const { track } = setup();
    const event = await fundedEvent(track);
    const reason = `Bad\n    at secretFunction (/srv/app.js:1:1)`;
    const result = await track.verifyEvent(event.id, registered(answering("MISMATCH", reason)));
    expect(result.statusReason).toBe("Bad");
    const long = await track.verifyEvent(event.id, registered(answering("UNAVAILABLE", "x".repeat(500))));
    expect(long.statusReason).toHaveLength(200);
  });

  it("an invalid checkedAt falls back to the current time", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const { track } = setup({ now: () => now });
    const event = await fundedEvent(track);
    const verifier = (async () => ({ outcome: "MATCH", checkedAt: "soon" })) as unknown as Verifier;
    expect((await track.verifyEvent(event.id, registered(verifier))).lastCheckedAt).toEqual(now);
  });

  it("throws EVENT_NOT_FOUND for an unknown event", async () => {
    const { track } = setup();
    await expectError(track.verifyEvent("missing", new Map()), "EVENT_NOT_FOUND");
  });

  describe("re-checking: the latest check wins", () => {
    it("VERIFIED becomes FAILED on a later mismatch", async () => {
      const { track } = setup();
      const event = await fundedEvent(track);
      await track.verifyEvent(event.id, registered(answering("MATCH")));
      const result = await track.verifyEvent(event.id, registered(answering("MISMATCH", "Changed.")));
      expect(result.verificationStatus).toBe("FAILED");
      expect(result.verifiedAt).toBeNull();
    });

    it("VERIFIED becomes PENDING when later checks are unavailable", async () => {
      const { track } = setup();
      const event = await fundedEvent(track);
      await track.verifyEvent(event.id, registered(answering("MATCH")));
      const result = await track.verifyEvent(event.id, registered(answering("UNAVAILABLE", "Down.")));
      expect(result.verificationStatus).toBe("PENDING");
      expect(result.verifiedAt).toBeNull();
    });

    it("FAILED can become VERIFIED if a later check matches", async () => {
      const { track } = setup();
      const event = await fundedEvent(track);
      await track.verifyEvent(event.id, registered(answering("MISMATCH", "Bad.")));
      const result = await track.verifyEvent(event.id, registered(answering("MATCH")));
      expect(result.verificationStatus).toBe("VERIFIED");
      expect(result.statusReason).toBeNull();
    });

    it("never changes the reference or expected", async () => {
      const { track } = setup();
      const event = await track.recordEvent(inputFor("MILESTONE_FUNDED", { expected: { amountBaseUnits: "1" } }));
      const result = await track.verifyEvent(event.id, registered(answering("MATCH")));
      expect(result.referenceValue).toBe(event.referenceValue);
      expect(result.expected).toEqual(event.expected);
    });
  });
});

describe("0G inference events", () => {
  it("can never be VERIFIED while no verifier exists, however often they are checked", async () => {
    const { track } = setup();
    const event = await track.recordEvent(inputFor("EVALUATION_COMPLETED"));
    for (let i = 0; i < 3; i += 1) {
      const result = await track.verifyEvent(event.id, new Map());
      expect(result.verificationStatus).toBe("PENDING");
      expect(result.statusReason).toBe("No independent check available yet.");
      expect(result.verifiedAt).toBeNull();
    }
  });

  it("are not checked by the chain verifier's registry entry", () => {
    expect(ZERO_G_KEY).not.toBe(ARC_KEY);
  });
});

describe("verifyProject", () => {
  const recordMany = async (track: ReturnType<typeof setup>["track"]) => {
    const events: StoredEvent[] = [];
    for (const eventType of ["MILESTONE_FUNDED", "WORK_SUBMITTED", "MILESTONE_APPROVED", "PAYMENT_RELEASED"] as const) {
      events.push(await track.recordEvent(inputFor(eventType)));
    }
    return events;
  };

  it("checks every event, including ones with no verifier", async () => {
    const { track } = setup();
    await recordMany(track);
    await track.recordEvent(inputFor("EVALUATION_COMPLETED"));
    const results = await track.verifyProject(PROJECT, registered(answering("MATCH")));
    expect(results).toHaveLength(5);
    expect(results.filter((e) => e.verificationStatus === "VERIFIED")).toHaveLength(4);
    expect(results.find((e) => e.eventType === "EVALUATION_COMPLETED")!.verificationStatus).toBe("PENDING");
    expect(results.every((e) => e.lastCheckedAt)).toBe(true);
  });

  it("one failing verifier does not stop the others", async () => {
    const { track } = setup();
    await recordMany(track);
    let call = 0;
    const flaky: Verifier = async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      return { outcome: "MATCH", checkedAt: new Date() };
    };
    const results = await track.verifyProject(PROJECT, registered(flaky));
    expect(results.filter((e) => e.verificationStatus === "VERIFIED")).toHaveLength(3);
    expect(results.filter((e) => e.verificationStatus === "PENDING")).toHaveLength(1);
  });

  it("respects the concurrency limit", async () => {
    const { track } = setup({ concurrency: 2 });
    await recordMany(track);
    let running = 0;
    let peak = 0;
    const counting: Verifier = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { outcome: "MATCH", checkedAt: new Date() };
    };
    await track.verifyProject(PROJECT, registered(counting));
    expect(peak).toBe(2);
  });

  it("does nothing for a project with no events", async () => {
    const { track } = setup();
    expect(await track.verifyProject(PROJECT, new Map())).toEqual([]);
  });
});
