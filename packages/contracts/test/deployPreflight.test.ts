import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PreflightError,
  checkSignerConfig,
  formatNative,
  isValidPrivateKey,
  resolveUsdcAddress,
  runPreflight,
  verifyDeployment,
  type ChainAccess,
  type EscrowReader,
} from "../src/lib/deployPreflight";
import { ARC_TESTNET_CONFIG } from "../src/lib/arc";

const DEPLOYER = "0x" + "d1".repeat(20);
const OFFICIAL = ARC_TESTNET_CONFIG.usdcContract;
// A syntactically valid key made of obviously fake data; it is never used to sign anything.
const FAKE_KEY = "0x" + "11".repeat(32);
const ETH = 10n ** 18n;

const goodEnv = { DEPLOYER_PRIVATE_KEY: FAKE_KEY };

function chain(over: Partial<ChainAccess> = {}): ChainAccess & { sent: number } {
  const c = {
    sent: 0,
    getChainId: async () => 5042002n,
    getBalance: async () => 10n * ETH,
    getCode: async () => "0x60806040",
    getErc20Decimals: async () => 6,
    estimateDeploy: async () => ({ gasLimit: 2_000_000n, maxFeePerGas: 10n ** 11n }), // 0.0002 USDC
    ...over,
  };
  return c;
}
const run = (over: { env?: object; networkName?: string; deployer?: string | undefined; chain?: ChainAccess } = {}) =>
  runPreflight({
    env: (over.env ?? goodEnv) as never,
    networkName: over.networkName ?? "arcTestnet",
    deployer: "deployer" in over ? over.deployer : DEPLOYER,
    chain: over.chain ?? chain(),
  });

async function fails(p: Promise<unknown>, code: string, textIncludes?: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof PreflightError, `expected PreflightError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (textIncludes) assert.match(e.message, new RegExp(textIncludes, "i"));
    assert.match(e.message, /nothing was sent/i, "every refusal says that nothing was sent");
    return true;
  });
}

test("a correct configuration passes and reports what it verified", async () => {
  const r = await run();
  assert.equal(r.chainId, 5042002);
  assert.equal(r.usdcAddress, OFFICIAL);
  assert.equal(r.usdcDecimals, 6);
  assert.equal(r.requiredBalance, (r.estimatedCost * 3n) / 2n);
  assert.ok(r.balance >= r.requiredBalance);
});

test("refuses any live network other than arcTestnet", async () => {
  for (const n of ["mainnet", "sepolia", "arcMainnet", ""]) await fails(run({ networkName: n }), "WRONG_NETWORK");
});

test("refuses without a usable deployer key, before touching the network", async () => {
  const c = chain({ getChainId: async () => { throw new Error("must not be called"); } });
  await fails(run({ env: {}, chain: c }), "NO_DEPLOYER_KEY", "DEPLOYER_PRIVATE_KEY is not set");
  await fails(run({ env: { DEPLOYER_PRIVATE_KEY: "   " }, chain: c }), "NO_DEPLOYER_KEY");
  await fails(run({ env: { DEPLOYER_PRIVATE_KEY: "not-a-key" }, chain: c }), "INVALID_DEPLOYER_KEY");
  await fails(run({ env: { DEPLOYER_PRIVATE_KEY: "0x1234" }, chain: c }), "INVALID_DEPLOYER_KEY");
  await fails(run({ deployer: undefined, chain: c }), "NO_SIGNER");
});

test("error messages never contain the private key", async () => {
  for (const env of [{ DEPLOYER_PRIVATE_KEY: "SECRET-not-hex-but-secret" }, { DEPLOYER_PRIVATE_KEY: FAKE_KEY, ARC_USDC_ADDRESS: "bad" }]) {
    try { await run({ env }); assert.fail("should throw"); } catch (e) {
      assert.ok(!String((e as Error).message).includes("SECRET-not-hex"), "raw value leaked");
      assert.ok(!String((e as Error).message).includes("1111111111111111"), "key material leaked");
    }
  }
});

test("USDC: defaults to the official address; rejects malformed or non-official addresses unless explicitly allowed", () => {
  assert.equal(resolveUsdcAddress({}), OFFICIAL);
  assert.equal(resolveUsdcAddress({ ARC_USDC_ADDRESS: OFFICIAL.toLowerCase() }), OFFICIAL.toLowerCase());
  assert.throws(() => resolveUsdcAddress({ ARC_USDC_ADDRESS: "0x123" }), (e: unknown) => e instanceof PreflightError && e.code === "INVALID_USDC_ADDRESS");
  const other = "0x" + "ab".repeat(20);
  assert.throws(() => resolveUsdcAddress({ ARC_USDC_ADDRESS: other }), (e: unknown) => e instanceof PreflightError && e.code === "NONSTANDARD_USDC_NOT_ALLOWED");
  assert.throws(() => resolveUsdcAddress({ ARC_USDC_ADDRESS: other, ALLOW_CUSTOM_USDC: "yes" }), PreflightError, "only the exact string 'true' counts");
  assert.equal(resolveUsdcAddress({ ARC_USDC_ADDRESS: other, ALLOW_CUSTOM_USDC: "true" }), other);
});

test("refuses when the RPC is unreachable or on the wrong chain", async () => {
  await fails(run({ chain: chain({ getChainId: async () => { throw new Error("ECONNREFUSED"); } }) }), "RPC_UNREACHABLE");
  await fails(run({ chain: chain({ getChainId: async () => 1n }) }), "CHAIN_ID_MISMATCH", "reports chain 1");
  await fails(run({ chain: chain({ getChainId: async () => 31337 }) }), "CHAIN_ID_MISMATCH");
});

test("refuses when the USDC address is not a contract, is not an ERC-20, or has the wrong decimals", async () => {
  await fails(run({ chain: chain({ getCode: async () => "0x" }) }), "USDC_NOT_A_CONTRACT");
  await fails(run({ chain: chain({ getErc20Decimals: async () => { throw new Error("call revert"); } }) }), "USDC_NOT_A_CONTRACT");
  await fails(run({ chain: chain({ getErc20Decimals: async () => 18 }) }), "USDC_WRONG_DECIMALS", "18 decimals");
  await fails(run({ chain: chain({ getErc20Decimals: async () => 0 }) }), "USDC_WRONG_DECIMALS");
});

test("refuses when gas cannot be estimated", async () => {
  await fails(run({ chain: chain({ estimateDeploy: async () => { throw new Error("revert"); } }) }), "ESTIMATE_FAILED");
  await fails(run({ chain: chain({ estimateDeploy: async () => ({ gasLimit: 0n, maxFeePerGas: 1n }) }) }), "ESTIMATE_FAILED");
  await fails(run({ chain: chain({ estimateDeploy: async () => ({ gasLimit: 1n, maxFeePerGas: 0n }) }) }), "ESTIMATE_FAILED");
});

test("refuses when the wallet cannot afford the deployment, with a clear message and the faucet", async () => {
  const cost = 2_000_000n * 10n ** 11n; // 0.0002 USDC
  const need = (cost * 3n) / 2n;
  await fails(run({ chain: chain({ getBalance: async () => 0n }) }), "INSUFFICIENT_BALANCE", "faucet");
  await fails(run({ chain: chain({ getBalance: async () => need - 1n }) }), "INSUFFICIENT_BALANCE", "needs about");
  const exactlyEnough = await run({ chain: chain({ getBalance: async () => need }) });
  assert.equal(exactlyEnough.balance, need);
});

test("balance read failure is a safe abort, not a crash", async () => {
  await fails(run({ chain: chain({ getBalance: async () => { throw new Error("rpc"); } }) }), "RPC_UNREACHABLE");
});

test("nothing in the preflight can send a transaction: the chain interface has no write method", () => {
  const methods = Object.keys(chain()).filter((k) => k !== "sent").sort();
  assert.deepEqual(methods, ["estimateDeploy", "getBalance", "getChainId", "getCode", "getErc20Decimals"], "exactly these read-only calls; estimateDeploy only estimates gas");
});

test("formatNative renders 18-decimal gas amounts", () => {
  assert.equal(formatNative(0n), "0");
  assert.equal(formatNative(ETH), "1");
  assert.equal(formatNative(ETH / 2n), "0.5");
  assert.equal(formatNative(200_000_000_000_000n), "0.0002");
  assert.equal(formatNative(123_456_789_000_000_000_000n), "123.456789");
});

test("isValidPrivateKey accepts 32-byte hex with or without 0x only", () => {
  assert.equal(isValidPrivateKey(FAKE_KEY), true);
  assert.equal(isValidPrivateKey("11".repeat(32)), true);
  for (const bad of [undefined, "", "0x", "0x" + "11".repeat(31), "0x" + "zz".repeat(32), "0x" + "11".repeat(33)]) assert.equal(isValidPrivateKey(bad), false);
  assert.doesNotThrow(() => checkSignerConfig({ DEPLOYER_PRIVATE_KEY: FAKE_KEY }));
});

// ---- post-deploy verification ----

const ESCROW = "0x" + "e5".repeat(20);
function reader(over: Partial<EscrowReader> = {}): EscrowReader {
  return {
    getChainId: async () => 5042002,
    getCode: async () => "0x6080",
    usdcToken: async () => OFFICIAL,
    owner: async () => DEPLOYER,
    paused: async () => false,
    ...over,
  };
}
const verify = (r: EscrowReader, over: object = {}) => verifyDeployment({ reader: r, escrow: ESCROW, expectedOwner: DEPLOYER, ...over });

test("verifyDeployment passes for a correct, unpaused escrow on Arc wired to the official USDC", async () => {
  const r = await verify(reader());
  assert.deepEqual([r.escrow, r.usdc, r.paused, r.chainId], [ESCROW, OFFICIAL, false, 5042002]);
});

test("verifyDeployment fails on every way a deployment can be wrong", async () => {
  const cases: Array<[string, Promise<unknown>]> = [
    ["no address", verifyDeployment({ reader: reader(), escrow: undefined })],
    ["bad address", verifyDeployment({ reader: reader(), escrow: "0x123" })],
    ["wrong chain", verify(reader({ getChainId: async () => 1 }))],
    ["no code", verify(reader({ getCode: async () => "0x" }))],
    ["not an escrow", verify(reader({ usdcToken: async () => { throw new Error("revert"); } }))],
    ["wrong usdc", verify(reader({ usdcToken: async () => "0x" + "ab".repeat(20) }))],
    ["wrong owner", verify(reader({ owner: async () => "0x" + "cd".repeat(20) }))],
    ["paused", verify(reader({ paused: async () => true }))],
  ];
  for (const [name, p] of cases) {
    await assert.rejects(p, (e: unknown) => e instanceof PreflightError && e.code === "DEPLOY_VERIFICATION_FAILED", name);
  }
  await assert.rejects(verify(reader({ getChainId: async () => { throw new Error("x"); } })), (e: unknown) => e instanceof PreflightError && e.code === "RPC_UNREACHABLE");
});

test("verifyDeployment compares addresses case-insensitively", async () => {
  await verify(reader({ usdcToken: async () => OFFICIAL.toUpperCase().replace("0X", "0x"), owner: async () => DEPLOYER.toUpperCase().replace("0X", "0x") }));
});
