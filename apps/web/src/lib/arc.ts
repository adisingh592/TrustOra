import { createPublicClient, http, defineChain } from "viem";
import { ARC_TESTNET_CONFIG as BASE_CONFIG } from "../../../../packages/contracts/src/lib/arc";

// Single source of truth lives in packages/contracts/src/lib/arc.ts.
// This module only adds the viem chain/client (with an optional ARC_RPC_URL override).
export {
  ARC_TESTNET_CONFIG,
  ERC20_ABI,
  TRUSTORA_ESCROW_ABI,
  CHAIN_MILESTONE_STATES,
  DB_STATE_BY_CHAIN_STATE,
  USDC_DECIMALS,
  bytes32ToProjectId,
  criteriaHashToBytes32,
  fromUsdcBaseUnits,
  projectIdToBytes32,
  toUsdcBaseUnits,
} from "../../../../packages/contracts/src/lib/arc";
export type { ChainMilestoneState, Hex } from "../../../../packages/contracts/src/lib/arc";

export function getArcRpcUrl(): string {
  return process.env.ARC_RPC_URL || BASE_CONFIG.rpcUrls.default.http[0];
}

export const arcTestnetChain = defineChain({
  id: BASE_CONFIG.id,
  name: BASE_CONFIG.name,
  nativeCurrency: { ...BASE_CONFIG.nativeCurrency },
  rpcUrls: {
    default: { http: [getArcRpcUrl()] },
  },
  blockExplorers: { default: { ...BASE_CONFIG.blockExplorers.default } },
});

export const arcPublicClient = createPublicClient({
  chain: arcTestnetChain,
  transport: http(getArcRpcUrl()),
});

/** Escrow address comes from server config only, never from request bodies. */
export function getEscrowAddress(): `0x${string}` | null {
  const v = process.env.ESCROW_CONTRACT_ADDRESS;
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/i.test(v) ? (v as `0x${string}`) : null;
}
