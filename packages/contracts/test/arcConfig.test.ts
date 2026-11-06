import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARC_TESTNET_CONFIG,
  CHAIN_MILESTONE_STATES,
  DB_STATE_BY_CHAIN_STATE,
  ERC20_ABI,
  bytes32ToProjectId,
  criteriaHashToBytes32,
  fromUsdcBaseUnits,
  projectIdToBytes32,
  toUsdcBaseUnits,
} from "../src/lib/arc";

test("Arc Testnet config matches the official docs (docs.arc.io)", () => {
  assert.equal(ARC_TESTNET_CONFIG.id, 5042002);
  assert.equal(ARC_TESTNET_CONFIG.rpcUrls.default.http[0], "https://rpc.testnet.arc.io");
  assert.equal(ARC_TESTNET_CONFIG.blockExplorers.default.url, "https://explorer.testnet.arc.io");
  assert.equal(ARC_TESTNET_CONFIG.usdcContract, "0x3600000000000000000000000000000000000000");
  assert.equal(ARC_TESTNET_CONFIG.faucetUrl, "https://faucet.circle.com");
});

test("native gas decimals (18) are kept distinct from ERC-20 USDC decimals (6)", () => {
  assert.equal(ARC_TESTNET_CONFIG.nativeCurrency.symbol, "USDC");
  assert.equal(ARC_TESTNET_CONFIG.nativeCurrency.decimals, 18);
  assert.equal(ARC_TESTNET_CONFIG.usdcDecimals, 6);
});

test("USDC amounts convert exactly to 6-decimal base units", () => {
  assert.equal(toUsdcBaseUnits("250"), 250_000_000n);
  assert.equal(toUsdcBaseUnits("0.000001"), 1n);
  assert.equal(toUsdcBaseUnits("1.5"), 1_500_000n);
  assert.equal(toUsdcBaseUnits(12.34), 12_340_000n);
  assert.equal(toUsdcBaseUnits(0.1 + 0.2), 300_000n);
  assert.equal(fromUsdcBaseUnits(1_500_000n), 1.5);
});

test("invalid USDC amounts are rejected", () => {
  for (const bad of ["", "-1", "1.1234567", "abc", "1e6", "1,5", NaN, Infinity, -5]) {
    assert.throws(() => toUsdcBaseUnits(bad as never), /Invalid USDC amount/, String(bad));
  }
});

test("project ID <-> bytes32 mapping is reversible and fixed-width", () => {
  const id = "TRU-PROJ-2026-0001042";
  const b = projectIdToBytes32(id);
  assert.match(b, /^0x[0-9a-f]{64}$/);
  assert.equal(b, "0x" + Buffer.from(id).toString("hex").padEnd(64, "0"));
  assert.equal(bytes32ToProjectId(b), id);
  assert.throws(() => projectIdToBytes32(""), /1-32/);
  assert.throws(() => projectIdToBytes32("x".repeat(33)), /1-32/);
  assert.throws(() => projectIdToBytes32("bad id"), /printable/);
  assert.throws(() => bytes32ToProjectId("0x1234"), /bytes32/);
});

test("criteria hash maps to a 0x-prefixed bytes32", () => {
  const h = "AB".repeat(32);
  assert.equal(criteriaHashToBytes32(h), "0x" + "ab".repeat(32));
  assert.equal(criteriaHashToBytes32("0x" + "ab".repeat(32)), "0x" + "ab".repeat(32));
  assert.throws(() => criteriaHashToBytes32("abc"), /32 bytes/);
});

test("every chain milestone state has a DB state, in contract enum order", () => {
  assert.deepEqual([...CHAIN_MILESTONE_STATES], [
    "Unfunded", "Funded", "Submitted", "RevisionRequested", "Approved", "Released", "Disputed", "Refunded",
  ]);
  for (const s of CHAIN_MILESTONE_STATES) assert.ok(DB_STATE_BY_CHAIN_STATE[s]);
});

test("ERC-20 ABI exposes approve and allowance", () => {
  const names: string[] = ERC20_ABI.filter((x) => x.type === "function").map((x) => x.name);
  assert.ok(names.includes("approve") && names.includes("allowance"));
});
