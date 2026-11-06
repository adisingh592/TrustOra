import type { EscrowState, ProofEventExpected, ProofEventType, VerifiedChainEvent } from "@trustora/shared";
import { describe, expect, it } from "vitest";
import { createChainVerifier } from "./chainVerifier.js";
import { MOCK_ChainAdapter } from "./mocks.js";
import type { StoredEvent } from "./types.js";

// All values are fake, built here at run time. No RPC is ever called.
const addr = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => digit.repeat(64);

const TX = `0x${hash("a")}`;
const MILESTONE = `0x${hash("b")}`;
const AGREEMENT = hash("c");
const DELIVERABLE = hash("d");
const ESCROW = addr("1");
const TOKEN = addr("2");
const CLIENT = addr("3");
const FREELANCER = addr("4");
const ARBITER = addr("5");
const AMOUNT = "50000000";

const config = {
  chainId: 5042002,
  rpcUrl: "https://FIXTURE.invalid",
  escrowAddress: ESCROW,
  tokenAddress: TOKEN,
  explorerBase: "https://FIXTURE.invalid",
};

const chainEvent: VerifiedChainEvent = {
  txHash: TX,
  chainId: 5042002,
  contractAddress: ESCROW,
  milestoneId: MILESTONE,
  amount: AMOUNT,
  token: TOKEN,
  freelancer: FREELANCER,
  agreementHash: `0x${AGREEMENT}`,
  blockNumber: 1,
  verified: true,
};

const escrow: EscrowState = {
  milestoneId: MILESTONE,
  client: CLIENT,
  freelancer: FREELANCER,
  arbiter: ARBITER,
  token: TOKEN,
  amount: AMOUNT,
  agreementHash: `0x${AGREEMENT}`,
  deliverableHash: `0x${DELIVERABLE}`,
  deadline: "2099-01-01T00:00:00.000Z",
  status: "FUNDED",
};

const expected: ProofEventExpected = {
  onchainMilestoneId: MILESTONE,
  amountBaseUnits: AMOUNT,
  tokenAddress: TOKEN,
  freelancerWallet: FREELANCER,
  agreementHash: AGREEMENT,
};

const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "MOCK_event",
  publicProjectId: "TRU-PROJ-2026-0000001",
  milestoneId: null,
  occurredAt: new Date(),
  createdAt: new Date(),
  ecosystem: "ARC",
  network: "Arc Testnet",
  chainId: 5042002,
  eventType: "MILESTONE_FUNDED",
  referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
  referenceValue: TX,
  verificationStatus: "PENDING",
  statusReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  summary: "x",
  expected,
  ...over,
});

const verify = (chain: Partial<VerifiedChainEvent> = {}, over: Partial<StoredEvent> = {}, state: Partial<EscrowState> = {}, cfg = {}) =>
  createChainVerifier(
    new MOCK_ChainAdapter({
      config: { ...config, ...cfg },
      chainEvent: { ...chainEvent, ...chain },
      escrow: { ...escrow, ...state },
    }),
  )(event(over));

describe("chain verifier", () => {
  it("MATCH when everything is equal", async () => {
    const result = await verify();
    expect(result.outcome).toBe("MATCH");
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it("MATCH when addresses and hashes differ only by case or 0x", async () => {
    const result = await verify({
      txHash: TX.toUpperCase().replace("0X", "0x"),
      contractAddress: ESCROW.toUpperCase().replace("0X", "0x"),
      token: TOKEN.toUpperCase().replace("0X", "0x"),
      freelancer: FREELANCER.toUpperCase().replace("0X", "0x"),
      agreementHash: AGREEMENT.toUpperCase(),
    });
    expect(result.outcome).toBe("MATCH");
  });

  it.each<[string, Partial<VerifiedChainEvent>, RegExp]>([
    ["failed transaction", { verified: false }, /did not succeed/],
    ["different transaction hash", { txHash: `0x${hash("e")}` }, /transaction hash/],
    ["wrong chain", { chainId: 1 }, /wrong chain/],
    ["wrong contract", { contractAddress: addr("9") }, /escrow contract/],
    ["wrong milestone", { milestoneId: `0x${hash("e")}` }, /milestone/],
    ["amount lower", { amount: "49999999" }, /amount/],
    ["amount higher", { amount: "50000001" }, /amount/],
    ["amount with decimals", { amount: "50000000.0" }, /amount/],
    ["wrong token", { token: addr("9") }, /token/],
    ["wrong freelancer", { freelancer: addr("9") }, /freelancer/],
    ["wrong agreement hash", { agreementHash: hash("e") }, /agreement hash/],
  ])("MISMATCH: %s", async (_label, chain, reason) => {
    const result = await verify(chain);
    expect(result.outcome).toBe("MISMATCH");
    expect(result.reason).toMatch(reason);
  });

  it("treats anything but verified: true as a failed transaction", async () => {
    const result = await verify({ verified: "true" as unknown as boolean });
    expect(result.outcome).toBe("MISMATCH");
  });

  it("never repeats compared values in the reason", async () => {
    const result = await verify({ amount: "49999999", token: addr("9") });
    expect(result.reason).not.toContain("49999999");
    expect(result.reason).not.toContain(AMOUNT);
  });

  it("MISMATCH when the token matches expected but not our configured token", async () => {
    const result = await verify({}, {}, {}, { tokenAddress: addr("9") });
    expect(result.outcome).toBe("MISMATCH");
    expect(result.reason).toMatch(/token/);
  });

  it("MISMATCH when the adapter is configured for another chain", async () => {
    const result = await verify({}, {}, {}, { chainId: 1 });
    expect(result.outcome).toBe("MISMATCH");
  });

  describe("fields only the escrow state has", () => {
    const withExtra = (extra: ProofEventExpected) => ({ expected: { ...expected, ...extra } });

    it("MATCH when client, arbiter and deliverable all agree", async () => {
      const result = await verify({}, withExtra({ clientWallet: CLIENT, arbiterWallet: ARBITER, deliverableSha256: DELIVERABLE }));
      expect(result.outcome).toBe("MATCH");
    });

    it.each<[string, ProofEventExpected, Partial<EscrowState>, RegExp]>([
      ["client", { clientWallet: CLIENT }, { client: addr("9") }, /client/],
      ["arbiter", { arbiterWallet: ARBITER }, { arbiter: addr("9") }, /arbiter/],
      ["deliverable", { deliverableSha256: DELIVERABLE }, { deliverableHash: hash("e") }, /deliverable/],
      ["missing deliverable", { deliverableSha256: DELIVERABLE }, { deliverableHash: undefined }, /deliverable/],
    ])("MISMATCH: wrong %s", async (_label, extra, state, reason) => {
      const result = await verify({}, withExtra(extra), state);
      expect(result.outcome).toBe("MISMATCH");
      expect(result.reason).toMatch(reason);
    });

    it("does not read the escrow state when nothing needs it", async () => {
      const adapter = new MOCK_ChainAdapter({ config, chainEvent });
      expect((await createChainVerifier(adapter)(event())).outcome).toBe("MATCH");
      expect(adapter.calls).toEqual(["verifyFunding"]);
    });
  });

  describe("it never matches against nothing", () => {
    it.each<keyof ProofEventExpected>([
      "onchainMilestoneId",
      "amountBaseUnits",
      "tokenAddress",
      "freelancerWallet",
      "agreementHash",
    ])("UNAVAILABLE when expected has no %s", async (field) => {
      const partial = { ...expected };
      delete partial[field];
      const result = await verify({}, { expected: partial });
      expect(result.outcome).toBe("UNAVAILABLE");
    });

    it("UNAVAILABLE when expected is empty", async () => {
      expect((await verify({}, { expected: {} })).outcome).toBe("UNAVAILABLE");
    });
  });

  describe("choosing the adapter method", () => {
    const callsFor = async (eventType: ProofEventType) => {
      const adapter = new MOCK_ChainAdapter({ config, chainEvent });
      const result = await createChainVerifier(adapter)(event({ eventType }));
      return { calls: adapter.calls, result };
    };

    it("funding uses verifyFunding", async () => {
      expect((await callsFor("MILESTONE_FUNDED")).calls).toEqual(["verifyFunding"]);
    });

    it("release uses verifyRelease", async () => {
      expect((await callsFor("PAYMENT_RELEASED")).calls).toEqual(["verifyRelease"]);
    });

    it.each(["WORK_SUBMITTED", "MILESTONE_APPROVED"] as const)(
      "%s has no adapter method, so it stays UNAVAILABLE and calls nothing",
      async (eventType) => {
        const { calls, result } = await callsFor(eventType);
        expect(result.outcome).toBe("UNAVAILABLE");
        expect(calls).toEqual([]);
      },
    );
  });

  it("an adapter outage rejects, so the core keeps the event PENDING", async () => {
    const adapter = new MOCK_ChainAdapter({ config, chainEvent, fail: new Error("rpc secret-host down") });
    await expect(createChainVerifier(adapter)(event())).rejects.toThrow();
  });
});
