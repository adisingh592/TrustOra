/**
 * Mirror Node verification with a FAKE fetch serving recorded-shape responses. No network is used.
 * These prove the verification rules, not that the Mirror Node is reachable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HederaSettlementVerifier, hashScanTransactionUrl, toMirrorTransactionId, type ExpectedSettlement } from "../src/verifier";

const PAYER = "0.0.5005";
const PAYTO = "0.0.6006";
const FEE_PAYER = "0.0.9185802";
const TXID = "0.0.9185802@1762400000.123456789";
const MIRROR_ID = "0.0.9185802-1762400000-123456789";
const AMOUNT = 10_000_000n;

const expected: ExpectedSettlement = { txId: TXID, payer: PAYER, payTo: PAYTO, amountTinybars: AMOUNT };

/** Shape of GET /api/v1/transactions/{id} on the Mirror Node. */
function mirrorTx(over: Record<string, unknown> = {}) {
  return {
    transactions: [{
      consensus_timestamp: "1762400003.000000001",
      transaction_id: MIRROR_ID,
      name: "CRYPTOTRANSFER",
      result: "SUCCESS",
      nonce: 0,
      charged_tx_fee: 100_000,
      transfers: [
        { account: PAYER, amount: -10_000_000, is_approval: false },
        { account: PAYTO, amount: 10_000_000, is_approval: false },
        { account: FEE_PAYER, amount: -100_000, is_approval: false },
        { account: "0.0.3", amount: 4_000, is_approval: false },
        { account: "0.0.98", amount: 96_000, is_approval: false },
      ],
      ...over,
    }],
  };
}

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (url: string) => {
    urls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, urls };
}
const verifierWith = (responses: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(responses);
  return { v: new HederaSettlementVerifier({ fetchImpl: f.impl }), urls: f.urls };
};

test("transaction IDs are converted to Mirror Node form correctly (regression: the old code produced 0-0.x)", () => {
  assert.equal(toMirrorTransactionId("0.0.1235@1700000000.000000000"), "0.0.1235-1700000000-000000000");
  assert.equal(toMirrorTransactionId(TXID), MIRROR_ID);
  assert.equal(toMirrorTransactionId(MIRROR_ID), MIRROR_ID, "already-converted IDs are accepted");
  for (const bad of ["", "0.0.1235", "0.0.1235@1700000000", "abc@1.2", "0.0.1235@1700000000.0.0", "0x" + "ab".repeat(32)]) {
    assert.equal(toMirrorTransactionId(bad), null, bad);
  }
});

test("VERIFIED: success, CRYPTOTRANSFER, payer debited and recipient credited exactly the amount", async () => {
  const { v, urls } = verifierWith([{ status: 200, body: mirrorTx() }]);
  const r = await v.check(expected);
  assert.equal(r.status, "VERIFIED");
  if (r.status === "VERIFIED") assert.equal(r.consensusTimestamp, "1762400003.000000001");
  assert.equal(urls[0], `https://testnet.mirrornode.hedera.com/api/v1/transactions/${MIRROR_ID}`);
});

test("not VERIFIED when the transaction failed on-chain", async () => {
  for (const result of ["INSUFFICIENT_PAYER_BALANCE", "INVALID_SIGNATURE", "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"]) {
    const { v } = verifierWith([{ status: 200, body: mirrorTx({ result }) }]);
    const r = await v.check(expected);
    assert.equal(r.status, "FAILED_ON_CHAIN", result);
  }
});

test("not VERIFIED when it succeeded but is not the agreed payment", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["wrong type", { name: "CONTRACTCALL" }],
    ["different tx id", { transaction_id: "0.0.1-1-1" }],
    ["recipient underpaid", { transfers: [{ account: PAYER, amount: -9_999_999 }, { account: PAYTO, amount: 9_999_999 }] }],
    ["recipient missing", { transfers: [{ account: PAYER, amount: -10_000_000 }, { account: "0.0.7777", amount: 10_000_000 }] }],
    ["payer not the debtor", { transfers: [{ account: "0.0.8888", amount: -10_000_000 }, { account: PAYTO, amount: 10_000_000 }] }],
    ["payer overcharged", { transfers: [{ account: PAYER, amount: -20_000_000 }, { account: PAYTO, amount: 10_000_000 }, { account: "0.0.7777", amount: 10_000_000 }] }],
    ["unsafe amount", { transfers: [{ account: PAYER, amount: -1e20 }, { account: PAYTO, amount: 1e20 }] }],
    ["no consensus timestamp", { consensus_timestamp: undefined }],
  ];
  for (const [name, over] of cases) {
    const { v } = verifierWith([{ status: 200, body: mirrorTx(over) }]);
    assert.equal((await v.check(expected)).status, "MISMATCH", name);
  }
});

test("Mirror Node lag and outages are reported as retryable, never as success", async () => {
  assert.equal((await verifierWith([{ status: 404, body: { _status: { messages: [{ message: "Not found" }] } } }]).v.check(expected)).status, "NOT_FOUND_YET");
  assert.equal((await verifierWith([{ status: 200, body: { transactions: [] } }]).v.check(expected)).status, "NOT_FOUND_YET");
  assert.equal((await verifierWith([{ status: 503 }]).v.check(expected)).status, "UNREACHABLE");
  assert.equal((await verifierWith([{ status: 429 }]).v.check(expected)).status, "UNREACHABLE");
  assert.equal((await verifierWith([new Error("ECONNRESET")]).v.check(expected)).status, "UNREACHABLE");
});

test("invalid inputs never reach the network", async () => {
  const { v, urls } = verifierWith([{ status: 200, body: mirrorTx() }]);
  assert.equal((await v.check({ ...expected, txId: "fabricated" })).status, "INVALID_TX_ID");
  assert.equal((await v.check({ ...expected, payTo: "not-an-account" })).status, "MISMATCH");
  assert.equal((await v.check({ ...expected, amountTinybars: 0n })).status, "MISMATCH");
  assert.equal(urls.length, 0);
});

test("waitForSettlement retries through lag, then stops at the first definitive answer", async () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  const lagThenOk = verifierWith([{ status: 404 }, { status: 503 }, { status: 200, body: mirrorTx() }]);
  const r = await lagThenOk.v.waitForSettlement(expected, { attempts: 6, delayMs: 10, sleep });
  assert.equal(r.status, "VERIFIED");
  assert.equal(lagThenOk.urls.length, 3);

  const failed = verifierWith([{ status: 404 }, { status: 200, body: mirrorTx({ result: "INVALID_SIGNATURE" }) }, { status: 200, body: mirrorTx() }]);
  assert.equal((await failed.v.waitForSettlement(expected, { attempts: 6, delayMs: 10, sleep })).status, "FAILED_ON_CHAIN");
  assert.equal(failed.urls.length, 2, "stops polling once the answer is definitive");

  const never = verifierWith([{ status: 404 }]);
  assert.equal((await never.v.waitForSettlement(expected, { attempts: 3, delayMs: 10, sleep })).status, "NOT_FOUND_YET", "gives up honestly, not as VERIFIED");
  assert.equal(never.urls.length, 3);
});

test("HashScan link encodes the transaction ID", () => {
  assert.equal(hashScanTransactionUrl("0.0.1001@1700000000.000000000"), "https://hashscan.io/testnet/transaction/0.0.1001%401700000000.000000000");
});
