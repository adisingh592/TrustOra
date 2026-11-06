import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  EscrowSyncError,
  deriveProjectStatus,
  isReachableDbState,
  planDbTransition,
  verifyEscrowTx,
  type ChainReader,
  type EscrowAction,
  type ExpectedEscrowContext,
  type ReceiptLike,
} from "../src/lib/escrow-sync";
import { TRUSTORA_ESCROW_ABI, projectIdToBytes32, toUsdcBaseUnits } from "../../../packages/contracts/src/lib/arc";

const ESCROW = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FREELANCER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ARBITER = "0xcccccccccccccccccccccccccccccccccccccccc";
const STRANGER = "0xdddddddddddddddddddddddddddddddddddddddd";
const TX = "0x" + "ab".repeat(32);
const PROJECT = "TRU-PROJ-2026-0001042";
const CRITERIA = "c".repeat(64);
const DELIVERABLE = "d".repeat(64);

const expected: ExpectedEscrowContext = {
  projectId: PROJECT,
  milestoneIndex: 1,
  clientAddress: CLIENT,
  freelancerAddress: FREELANCER,
  arbiterAddress: null,
  criteriaHash: CRITERIA,
  amountUsdc: 250,
  expectedDeliverableHash: DELIVERABLE,
};

function log(eventName: string, args: Record<string, unknown>, dataTypes: { type: string }[], dataValues: unknown[], address = ESCROW) {
  const topics = encodeEventTopics({ abi: TRUSTORA_ESCROW_ABI, eventName: eventName as never, args: args as never });
  const data = dataTypes.length ? encodeAbiParameters(dataTypes as never, dataValues as never) : "0x";
  return { address, topics: topics as string[], data: data as string };
}

const pid = projectIdToBytes32(PROJECT);
const fundedLog = (o: { project?: string; milestone?: bigint; address?: string } = {}) =>
  log("MilestoneFunded", { projectId: o.project ?? pid, milestoneId: o.milestone ?? 1n, client: CLIENT },
    [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 1700000000n], o.address);

function setup(opts: {
  receipt?: Partial<ReceiptLike> | "missing" | "rpc-error";
  chainState?: number;
  project?: Partial<{ client: string; freelancer: string; arbiter: string; exists: boolean }>;
  milestone?: Partial<{ criteriaHash: string; amount: bigint; deliverableHash: string }>;
  logs?: ReceiptLike["logs"];
} = {}) {
  const calls: string[] = [];
  const reader: ChainReader = {
    async getTransactionReceipt() {
      calls.push("receipt");
      if (opts.receipt === "missing") throw Object.assign(new Error("nf"), { name: "TransactionReceiptNotFoundError" });
      if (opts.receipt === "rpc-error") throw new Error("boom");
      return {
        status: "success", from: CLIENT, to: ESCROW, blockNumber: 42n,
        logs: opts.logs ?? [fundedLog()],
        ...(opts.receipt as Partial<ReceiptLike> | undefined),
      };
    },
    async readContract(a) {
      calls.push(a.functionName);
      if (a.functionName === "getProject") {
        return { client: CLIENT, freelancer: FREELANCER, arbiter: ARBITER, exists: true, ...opts.project };
      }
      return {
        criteriaHash: "0x" + CRITERIA, amount: toUsdcBaseUnits(250), state: opts.chainState ?? 1,
        deliverableHash: "0x" + DELIVERABLE, deliverableUri: "ipfs://x", ...opts.milestone,
      };
    },
  };
  return { reader, calls };
}

const run = (reader: ChainReader, action: EscrowAction = "fund", exp = expected, escrow: string | null = ESCROW, tx = TX) =>
  verifyEscrowTx(reader, { txHash: tx, escrowAddress: escrow, action, expected: exp });

async function rejects(p: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof EscrowSyncError, `expected EscrowSyncError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (status) assert.equal(e.httpStatus, status);
    return true;
  });
}

test("fund: valid tx is verified and DB state comes from the contract", async () => {
  const { reader } = setup();
  const v = await run(reader);
  assert.equal(v.dbState, "FUNDED");
  assert.equal(v.chainState, "Funded");
  assert.equal(v.senderRole, "client");
  assert.equal(v.blockNumber, 42n);
});

test("DB state is read from the contract, not inferred from the tx (fund tx, chain already Submitted)", async () => {
  const { reader } = setup({ chainState: 2 });
  assert.equal((await run(reader)).dbState, "SUBMITTED");
});

test("rejects: missing config, malformed hash", async () => {
  const { reader, calls } = setup();
  await rejects(run(reader, "fund", expected, null), "ESCROW_NOT_CONFIGURED", 503);
  await rejects(run(reader, "fund", expected, ESCROW, "0x1234"), "INVALID_TX_HASH", 400);
  assert.deepEqual(calls, [], "no RPC call before input validation");
});

test("rejects: receipt not found / rpc failure / reverted", async () => {
  await rejects(run(setup({ receipt: "missing" }).reader), "RECEIPT_NOT_FOUND", 409);
  await rejects(run(setup({ receipt: "rpc-error" }).reader), "CHAIN_READ_FAILED", 502);
  await rejects(run(setup({ receipt: { status: "reverted" } }).reader), "TX_REVERTED", 422);
});

test("rejects: tx sent to a different contract, even if it carries a look-alike event", async () => {
  await rejects(run(setup({ receipt: { to: OTHER } }).reader), "WRONG_CONTRACT", 422);
  await rejects(run(setup({ receipt: { to: null } }).reader), "WRONG_CONTRACT");
});

test("rejects: event emitted by another contract address", async () => {
  await rejects(run(setup({ logs: [fundedLog({ address: OTHER })] }).reader), "EVENT_NOT_FOUND", 422);
});

test("rejects replay: event belongs to another project or milestone", async () => {
  const otherProject = projectIdToBytes32("TRU-PROJ-2026-0009999");
  await rejects(run(setup({ logs: [fundedLog({ project: otherProject })] }).reader), "EVENT_NOT_FOUND");
  await rejects(run(setup({ logs: [fundedLog({ milestone: 2n })] }).reader), "EVENT_NOT_FOUND");
  await rejects(run(setup({ logs: [] }).reader), "EVENT_NOT_FOUND");
});

test("rejects: right tx, wrong action (funded event submitted to the release route)", async () => {
  await rejects(run(setup().reader, "release"), "EVENT_NOT_FOUND");
});

test("authorization: sender must hold the on-chain role", async () => {
  await rejects(run(setup({ receipt: { from: STRANGER } }).reader), "SENDER_NOT_AUTHORIZED", 403);
  await rejects(run(setup({ receipt: { from: FREELANCER } }).reader), "SENDER_NOT_AUTHORIZED"); // freelancer cannot fund
  const { reader } = setup({ receipt: { from: CLIENT.toUpperCase().replace("0X", "0x") } });
  assert.equal((await run(reader)).senderRole, "client"); // case-insensitive
});

test("parties on-chain must match the database", async () => {
  await rejects(run(setup({ project: { client: STRANGER } }).reader), "PARTY_MISMATCH", 409);
  await rejects(run(setup({ project: { freelancer: STRANGER } }).reader), "PARTY_MISMATCH");
  await rejects(run(setup().reader, "fund", { ...expected, freelancerAddress: null }), "PARTY_MISMATCH");
  await rejects(run(setup().reader, "fund", { ...expected, arbiterAddress: STRANGER }), "PARTY_MISMATCH");
  await rejects(run(setup({ project: { exists: false } }).reader), "PROJECT_NOT_ON_CHAIN", 409);
});

test("terms on-chain must match the locked agreement", async () => {
  await rejects(run(setup({ milestone: { criteriaHash: "0x" + "e".repeat(64) } }).reader), "CRITERIA_MISMATCH");
  await rejects(run(setup({ milestone: { amount: toUsdcBaseUnits(249.99) } }).reader), "AMOUNT_MISMATCH");
  await rejects(run(setup().reader, "fund", { ...expected, amountUsdc: -1 }), "AMOUNT_MISMATCH");
});

test("submit: anchored deliverable hash must equal the stored submission", async () => {
  const submitted = (hash: string) =>
    log("MilestoneSubmitted", { projectId: pid, milestoneId: 1n, freelancer: FREELANCER },
      [{ type: "bytes32" }, { type: "string" }, { type: "uint64" }], [hash, "ipfs://x", 1n]);
  const ok = setup({ receipt: { from: FREELANCER }, logs: [submitted("0x" + DELIVERABLE)], chainState: 2 });
  const v = await run(ok.reader, "submit");
  assert.equal(v.dbState, "SUBMITTED");
  assert.equal(v.senderRole, "freelancer");
  const bad = setup({ receipt: { from: FREELANCER }, logs: [submitted("0x" + "f".repeat(64))], chainState: 2 });
  await rejects(run(bad.reader, "submit"), "DELIVERABLE_MISMATCH");
  await rejects(run(ok.reader, "submit", { ...expected, expectedDeliverableHash: undefined }), "DELIVERABLE_MISMATCH");
  await rejects(run(setup({ receipt: { from: CLIENT }, logs: [submitted("0x" + DELIVERABLE)] }).reader, "submit"), "SENDER_NOT_AUTHORIZED");
});

test("release: only the client; refund: only the freelancer; dispute: either; resolve: arbiter", async () => {
  const released = log("MilestoneReleased", { projectId: pid, milestoneId: 1n, freelancer: FREELANCER }, [{ type: "uint256" }, { type: "uint64" }], [1n, 1n]);
  assert.equal((await run(setup({ logs: [released], chainState: 5 }).reader, "release")).dbState, "RELEASED");
  await rejects(run(setup({ logs: [released], chainState: 5, receipt: { from: FREELANCER } }).reader, "release"), "SENDER_NOT_AUTHORIZED");
  await rejects(run(setup({ logs: [released], chainState: 5, receipt: { from: ARBITER } }).reader, "release"), "SENDER_NOT_AUTHORIZED");

  const refunded = log("MilestoneRefunded", { projectId: pid, milestoneId: 1n, client: CLIENT }, [{ type: "uint256" }, { type: "uint64" }], [1n, 1n]);
  assert.equal((await run(setup({ logs: [refunded], chainState: 7, receipt: { from: FREELANCER } }).reader, "refund")).dbState, "REFUNDED");
  await rejects(run(setup({ logs: [refunded], chainState: 7 }).reader, "refund"), "SENDER_NOT_AUTHORIZED");

  const disputed = log("MilestoneDisputed", { projectId: pid, milestoneId: 1n, initiator: CLIENT }, [{ type: "string" }, { type: "uint64" }], ["why", 1n]);
  for (const from of [CLIENT, FREELANCER]) {
    assert.equal((await run(setup({ logs: [disputed], chainState: 6, receipt: { from } }).reader, "dispute")).dbState, "DISPUTED");
  }
  await rejects(run(setup({ logs: [disputed], chainState: 6, receipt: { from: STRANGER } }).reader, "dispute"), "SENDER_NOT_AUTHORIZED");

  const resolved = log("DisputeResolved", { projectId: pid, milestoneId: 1n, arbiter: ARBITER }, [{ type: "uint256" }, { type: "uint256" }, { type: "uint64" }], [1n, 0n, 1n]);
  assert.equal((await run(setup({ logs: [resolved], chainState: 5, receipt: { from: ARBITER } }).reader, "resolve")).senderRole, "arbiter");
  await rejects(run(setup({ logs: [resolved], chainState: 5, receipt: { from: CLIENT } }).reader, "resolve"), "SENDER_NOT_AUTHORIZED");

  const revision = log("RevisionRequested", { projectId: pid, milestoneId: 1n, client: CLIENT }, [{ type: "string" }], ["fix"]);
  assert.equal((await run(setup({ logs: [revision], chainState: 3 }).reader, "revision")).dbState, "REVISION_REQUESTED");
});

test("rejects when the RPC node's contract state does not yet reflect the tx (lagging node)", async () => {
  const released = log("MilestoneReleased", { projectId: pid, milestoneId: 1n, freelancer: FREELANCER }, [{ type: "uint256" }, { type: "uint64" }], [1n, 1n]);
  await rejects(run(setup({ logs: [released], chainState: 1 }).reader, "release"), "CHAIN_STATE_BEHIND", 409); // still Funded
  await rejects(run(setup({ chainState: 0 }).reader), "CHAIN_STATE_BEHIND"); // fund event but Unfunded
  assert.equal((await run(setup({ logs: [released], chainState: 5 }).reader, "release")).dbState, "RELEASED");
});

// ---- state transitions ----

test("planDbTransition: idempotent, forward, and multi-step catch-up are allowed", () => {
  assert.equal(planDbTransition("FUNDED", "FUNDED"), "NOOP");
  assert.equal(planDbTransition("UNFUNDED", "FUNDED"), "ADVANCE");
  assert.equal(planDbTransition("FUNDED", "SUBMITTED"), "ADVANCE");
  assert.equal(planDbTransition("SUBMITTED", "REVISION_REQUESTED"), "ADVANCE");
  assert.equal(planDbTransition("REVISION_REQUESTED", "SUBMITTED"), "ADVANCE");
  assert.equal(planDbTransition("UNFUNDED", "RELEASED"), "ADVANCE"); // missed intermediate syncs
  assert.equal(planDbTransition("DISPUTED", "REFUNDED"), "ADVANCE");
});

test("planDbTransition: terminal states and regressions are rejected", () => {
  for (const [from, to] of [
    ["RELEASED", "FUNDED"], ["RELEASED", "REFUNDED"], ["REFUNDED", "RELEASED"],
    ["SUBMITTED", "FUNDED"], ["FUNDED", "UNFUNDED"], ["DISPUTED", "SUBMITTED"],
  ] as const) {
    assert.throws(() => planDbTransition(from, to), (e: unknown) => e instanceof EscrowSyncError && e.code === "INVALID_TRANSITION" && e.httpStatus === 409, `${from}->${to}`);
  }
  assert.equal(isReachableDbState("UNFUNDED", "UNFUNDED"), false);
});

test("deriveProjectStatus", () => {
  assert.equal(deriveProjectStatus("AGREED", ["FUNDED"]), "FUNDED");
  assert.equal(deriveProjectStatus("FUNDED", ["SUBMITTED"]), "IN_PROGRESS");
  assert.equal(deriveProjectStatus("FUNDED", ["DISPUTED", "RELEASED"]), "DISPUTED");
  assert.equal(deriveProjectStatus("FUNDED", ["RELEASED", "REFUNDED"]), "COMPLETED");
  assert.equal(deriveProjectStatus("FUNDED", ["RELEASED", "FUNDED"]), "IN_PROGRESS");
  assert.equal(deriveProjectStatus("AGREED", ["UNFUNDED"]), "AGREED");
  assert.equal(deriveProjectStatus("AGREED", []), "AGREED");
});
