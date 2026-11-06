// SPDX-License-Identifier: MIT
/**
 * Single source of truth for Arc Testnet configuration, escrow ID mapping and token helpers.
 * Pure module (no I/O, no viem import) so it is usable from Hardhat, tests and the web app.
 * The web app adds the viem client on top of this in apps/web/src/lib/arc.ts.
 *
 * Verified against the official Arc docs (docs.arc.io: "Connect to Arc" and "Contract addresses"):
 * - Chain ID: 5042002 (0x4cef52)
 * - RPC (primary): https://rpc.testnet.arc.io
 * - Explorer: https://explorer.testnet.arc.io
 * - Native gas token: USDC with 18 decimals of precision
 * - USDC ERC-20 interface: 0x3600000000000000000000000000000000000000 with 6 decimals
 * - Native USDC and ERC-20 USDC are the SAME balance viewed through two precisions.
 *   Escrow amounts use the ERC-20 interface (6 decimals); never mix it with native 18-decimal values.
 */
export { TRUSTORA_ESCROW_ABI } from "./escrow-abi";

export const ARC_TESTNET_CONFIG = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  /** Native gas token precision (NOT the ERC-20 precision). */
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  usdcContract: "0x3600000000000000000000000000000000000000",
  /** ERC-20 interface precision, used for all escrow amounts. */
  usdcDecimals: 6,
  studioUrl: "https://studio.arc.io",
  faucetUrl: "https://faucet.circle.com",
} as const;

export const USDC_DECIMALS = ARC_TESTNET_CONFIG.usdcDecimals;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/** Minimal ERC-20 ABI needed for the client wallet to approve and for the app to read allowance/balance. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

/**
 * Converts a human-readable USDC amount to integer ERC-20 base units (6 decimals).
 * Strings are parsed exactly; numbers are first rendered with 6 fixed decimals.
 * Rejects negatives, non-numeric input and more than 6 decimal places.
 */
export function toUsdcBaseUnits(amount: number | string): bigint {
  const str = typeof amount === "number" ? (Number.isFinite(amount) ? amount.toFixed(USDC_DECIMALS) : "NaN") : amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(str)) {
    throw new Error(`Invalid USDC amount: ${String(amount)}`);
  }
  const [whole, decimal = ""] = str.split(".");
  return BigInt(whole!) * USDC_UNIT + BigInt(decimal.padEnd(USDC_DECIMALS, "0"));
}

/** Converts ERC-20 base units to a display number. Display only; never feed the result back into token math. */
export function fromUsdcBaseUnits(units: bigint): number {
  return Number(units) / Number(USDC_UNIT);
}

// ---------------------------------------------------------------------------
// ID mapping between the SQLite database and TrustoraEscrow.sol
//
//   DB Project.id          "TRU-PROJ-2026-0001042"  <->  on-chain bytes32 projectId
//       = the ASCII string, right-padded with zero bytes (reversible, no lookup table needed)
//   DB Milestone.milestoneIndex (1-based)           <->  on-chain milestoneId (uint256, 1-based)
//       The contract numbers milestones sequentially from 1 in addMilestone order, so the
//       client must add milestones on-chain in milestoneIndex order.
//   DB criteria hash (64 hex chars, SHA-256)        <->  on-chain bytes32 criteriaHash ("0x" + hash)
// ---------------------------------------------------------------------------

export type Hex = `0x${string}`;

/** Encodes a DB project ID as the contract's bytes32 projectId. */
export function projectIdToBytes32(projectId: string): Hex {
  if (!/^[\x21-\x7e]{1,32}$/.test(projectId)) {
    throw new Error("Project ID must be 1-32 printable ASCII characters");
  }
  let hex = "";
  for (let i = 0; i < projectId.length; i++) hex += projectId.charCodeAt(i).toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0")}` as Hex;
}

/** Decodes an on-chain bytes32 projectId back to the DB project ID. */
export function bytes32ToProjectId(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Not a bytes32 value");
  let out = "";
  for (let i = 2; i < 66; i += 2) {
    const code = parseInt(value.slice(i, i + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/** Converts the DB's 64-char hex SHA-256 criteria hash to the on-chain bytes32 form. */
export function criteriaHashToBytes32(hash: string): Hex {
  const h = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("Criteria hash must be 32 bytes of hex");
  return `0x${h.toLowerCase()}` as Hex;
}

/** Contract MilestoneState enum, in declaration order. */
export const CHAIN_MILESTONE_STATES = [
  "Unfunded",
  "Funded",
  "Submitted",
  "RevisionRequested",
  "Approved",
  "Released",
  "Disputed",
  "Refunded",
] as const;
export type ChainMilestoneState = (typeof CHAIN_MILESTONE_STATES)[number];

/** DB Milestone.state value for each on-chain state. */
export const DB_STATE_BY_CHAIN_STATE: Record<ChainMilestoneState, string> = {
  Unfunded: "UNFUNDED",
  Funded: "FUNDED",
  Submitted: "SUBMITTED",
  RevisionRequested: "REVISION_REQUESTED",
  Approved: "APPROVED",
  Released: "RELEASED",
  Disputed: "DISPUTED",
  Refunded: "REFUNDED",
};
