// SPDX-License-Identifier: MIT
/**
 * Deployment preflight: every check that must pass BEFORE a deploy transaction is sent, and the read-only
 * verification after one. Pure logic over an injected `ChainAccess`, so each failure mode is unit-tested
 * without a network. scripts/deploy.ts and scripts/check-deployment.ts only wire ethers into these.
 *
 * Fail-safe by design: any doubt (no key, wrong chain, odd USDC, low balance, failed estimate) aborts
 * before anything is sent. Nothing here ever prints or returns a private key.
 */
import { ARC_TESTNET_CONFIG } from "./arc";

export type PreflightCode =
  | "WRONG_NETWORK"
  | "NO_DEPLOYER_KEY"
  | "INVALID_DEPLOYER_KEY"
  | "NO_SIGNER"
  | "INVALID_USDC_ADDRESS"
  | "NONSTANDARD_USDC_NOT_ALLOWED"
  | "RPC_UNREACHABLE"
  | "CHAIN_ID_MISMATCH"
  | "USDC_NOT_A_CONTRACT"
  | "USDC_WRONG_DECIMALS"
  | "ESTIMATE_FAILED"
  | "INSUFFICIENT_BALANCE"
  | "DEPLOY_VERIFICATION_FAILED";

export class PreflightError extends Error {
  constructor(readonly code: PreflightCode, message: string) {
    super(message);
    this.name = "PreflightError";
  }
}

export interface DeployEnv {
  DEPLOYER_PRIVATE_KEY?: string;
  ARC_USDC_ADDRESS?: string;
  /** Must be exactly "true" to deploy against a USDC address other than Arc's official one. */
  ALLOW_CUSTOM_USDC?: string;
}

/** Everything the preflight needs from a chain. Implemented with ethers in the scripts and with fakes in tests. */
export interface ChainAccess {
  getChainId(): Promise<bigint | number>;
  getBalance(address: string): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getErc20Decimals(address: string): Promise<number>;
  /** Gas limit and max fee per gas for deploying the escrow with the given USDC address. */
  estimateDeploy(usdcAddress: string): Promise<{ gasLimit: bigint; maxFeePerGas: bigint }>;
}

export interface PreflightReport {
  networkName: string;
  chainId: number;
  deployer: string;
  usdcAddress: string;
  usdcDecimals: number;
  balance: bigint;
  estimatedCost: bigint;
  requiredBalance: bigint;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/; // secret-scan:allow (format regex, not a literal key)
export const LOCAL_NETWORKS = ["hardhat", "localhost"];
/** Safety margin over the estimate: fees can move between estimate and send. */
export const BALANCE_BUFFER_NUM = 3n;
export const BALANCE_BUFFER_DEN = 2n;

export const isValidPrivateKey = (v: string | undefined): boolean => !!v && PRIVATE_KEY.test(v.trim());

/** Formats a native-gas amount (Arc's gas token is USDC with 18 decimals) for humans. */
export function formatNative(wei: bigint, decimals = ARC_TESTNET_CONFIG.nativeCurrency.decimals): string {
  const unit = 10n ** BigInt(decimals);
  const whole = wei / unit;
  const frac = (wei % unit).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Resolves the USDC address to use, refusing anything other than Arc's official USDC unless explicitly allowed. */
export function resolveUsdcAddress(env: DeployEnv): string {
  const configured = env.ARC_USDC_ADDRESS?.trim();
  const official = ARC_TESTNET_CONFIG.usdcContract;
  if (!configured) return official;
  if (!ADDRESS.test(configured)) {
    throw new PreflightError("INVALID_USDC_ADDRESS", "ARC_USDC_ADDRESS is set but is not a valid 20-byte address. Nothing was sent.");
  }
  if (configured.toLowerCase() !== official.toLowerCase() && env.ALLOW_CUSTOM_USDC !== "true") {
    throw new PreflightError(
      "NONSTANDARD_USDC_NOT_ALLOWED",
      `ARC_USDC_ADDRESS differs from Arc's official USDC (${official}). Escrowing a different token is almost certainly a mistake; set ALLOW_CUSTOM_USDC=true only if you really mean it. Nothing was sent.`,
    );
  }
  return configured;
}

/** Live networks need a well-formed deployer key. Called before any RPC so the error is immediate and clear. */
export function checkSignerConfig(env: DeployEnv): void {
  const key = env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!key) {
    throw new PreflightError("NO_DEPLOYER_KEY", "DEPLOYER_PRIVATE_KEY is not set (packages/contracts/.env). Nothing was sent.");
  }
  if (!isValidPrivateKey(key)) {
    throw new PreflightError("INVALID_DEPLOYER_KEY", "DEPLOYER_PRIVATE_KEY is set but is not a 32-byte hex key. (The value is not shown.) Nothing was sent.");
  }
}

/**
 * Runs every pre-send check for a LIVE (non-local) deployment and returns what was verified.
 * Throws PreflightError on the first problem; callers must not send a transaction if it throws.
 */
export async function runPreflight(p: {
  env: DeployEnv;
  networkName: string;
  deployer: string | undefined;
  chain: ChainAccess;
}): Promise<PreflightReport> {
  const expectedChainId = ARC_TESTNET_CONFIG.id;

  if (p.networkName !== "arcTestnet") {
    throw new PreflightError("WRONG_NETWORK", `Refusing to deploy to "${p.networkName}". Live deployments are only allowed on arcTestnet (chain ${expectedChainId}). Nothing was sent.`);
  }
  checkSignerConfig(p.env);
  if (!p.deployer) {
    throw new PreflightError("NO_SIGNER", "Hardhat produced no deployer account from DEPLOYER_PRIVATE_KEY. Nothing was sent.");
  }
  const usdcAddress = resolveUsdcAddress(p.env);

  let chainId: number;
  try {
    chainId = Number(await p.chain.getChainId());
  } catch {
    throw new PreflightError("RPC_UNREACHABLE", "Could not reach the Arc RPC endpoint. Check ARC_RPC_URL and your connection. Nothing was sent.");
  }
  if (chainId !== expectedChainId) {
    throw new PreflightError("CHAIN_ID_MISMATCH", `The RPC reports chain ${chainId}, but Arc Testnet is ${expectedChainId}. Wrong ARC_RPC_URL? Nothing was sent.`);
  }

  let code: string;
  let usdcDecimals: number;
  try {
    code = await p.chain.getCode(usdcAddress);
    usdcDecimals = Number(await p.chain.getErc20Decimals(usdcAddress));
  } catch {
    throw new PreflightError("USDC_NOT_A_CONTRACT", `Could not read decimals() from ${usdcAddress}; it does not behave like an ERC-20. Nothing was sent.`);
  }
  if (!code || code === "0x") {
    throw new PreflightError("USDC_NOT_A_CONTRACT", `No contract exists at the USDC address ${usdcAddress} on this chain. Nothing was sent.`);
  }
  if (usdcDecimals !== ARC_TESTNET_CONFIG.usdcDecimals) {
    throw new PreflightError("USDC_WRONG_DECIMALS", `USDC at ${usdcAddress} reports ${usdcDecimals} decimals; the escrow's accounting assumes ${ARC_TESTNET_CONFIG.usdcDecimals}. Nothing was sent.`);
  }

  let estimate: { gasLimit: bigint; maxFeePerGas: bigint };
  try {
    estimate = await p.chain.estimateDeploy(usdcAddress);
  } catch {
    throw new PreflightError("ESTIMATE_FAILED", "Could not estimate the deployment gas (the transaction may revert, or fee data is unavailable). Nothing was sent.");
  }
  if (estimate.gasLimit <= 0n || estimate.maxFeePerGas <= 0n) {
    throw new PreflightError("ESTIMATE_FAILED", "Gas estimate or fee data was empty. Nothing was sent.");
  }

  const estimatedCost = estimate.gasLimit * estimate.maxFeePerGas;
  const requiredBalance = (estimatedCost * BALANCE_BUFFER_NUM) / BALANCE_BUFFER_DEN;
  const balance = await p.chain.getBalance(p.deployer).catch(() => {
    throw new PreflightError("RPC_UNREACHABLE", "Could not read the deployer balance. Nothing was sent.");
  });
  if (balance < requiredBalance) {
    throw new PreflightError(
      "INSUFFICIENT_BALANCE",
      `Deployer ${p.deployer} holds ${formatNative(balance)} USDC (gas) but needs about ${formatNative(requiredBalance)} USDC ` +
        `(estimate ${formatNative(estimatedCost)} plus a safety margin). Fund it at ${ARC_TESTNET_CONFIG.faucetUrl}. Nothing was sent.`,
    );
  }

  return { networkName: p.networkName, chainId, deployer: p.deployer, usdcAddress, usdcDecimals, balance, estimatedCost, requiredBalance };
}

// ---------------------------------------------------------------------------
// Read-only verification of a deployed escrow (used right after deploying and by scripts/check-deployment.ts)
// ---------------------------------------------------------------------------

export interface EscrowReader {
  getChainId(): Promise<bigint | number>;
  getCode(address: string): Promise<string>;
  usdcToken(escrow: string): Promise<string>;
  owner(escrow: string): Promise<string>;
  paused(escrow: string): Promise<boolean>;
}

export interface DeploymentReport {
  escrow: string;
  usdc: string;
  owner: string;
  paused: boolean;
  chainId: number;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function verifyDeployment(p: {
  reader: EscrowReader;
  escrow: string | undefined;
  expectedUsdc?: string;
  expectedOwner?: string;
}): Promise<DeploymentReport> {
  const fail = (m: string) => new PreflightError("DEPLOY_VERIFICATION_FAILED", m);
  if (!p.escrow || !ADDRESS.test(p.escrow)) throw fail("ESCROW_CONTRACT_ADDRESS is missing or is not a valid address.");
  const expectedUsdc = p.expectedUsdc ?? ARC_TESTNET_CONFIG.usdcContract;

  let chainId: number;
  try {
    chainId = Number(await p.reader.getChainId());
  } catch {
    throw new PreflightError("RPC_UNREACHABLE", "Could not reach the Arc RPC endpoint.");
  }
  if (chainId !== ARC_TESTNET_CONFIG.id) throw fail(`The RPC reports chain ${chainId}, not Arc Testnet (${ARC_TESTNET_CONFIG.id}).`);

  const code = await p.reader.getCode(p.escrow).catch(() => "0x");
  if (!code || code === "0x") throw fail(`No contract exists at ${p.escrow} on Arc Testnet.`);

  let usdc: string, owner: string, paused: boolean;
  try {
    [usdc, owner, paused] = await Promise.all([p.reader.usdcToken(p.escrow), p.reader.owner(p.escrow), p.reader.paused(p.escrow)]);
  } catch {
    throw fail(`${p.escrow} does not expose the TrustoraEscrow interface (usdcToken/owner/paused failed).`);
  }
  if (!same(usdc, expectedUsdc)) throw fail(`The escrow is wired to USDC ${usdc}, expected ${expectedUsdc}.`);
  if (p.expectedOwner && !same(owner, p.expectedOwner)) throw fail(`The escrow owner is ${owner}, expected ${p.expectedOwner}.`);
  if (paused) throw fail("The escrow is paused; no milestone action will succeed until the owner unpauses it.");
  return { escrow: p.escrow, usdc, owner, paused, chainId };
}
