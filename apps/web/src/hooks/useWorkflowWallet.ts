"use client";

import { useArcWallet } from "./useArcWallet";
import type { ProjectResponse } from "./useProject";
import type { WalletContext } from "@/lib/workflow";

/** Wallet + server readiness for the action rules in lib/workflow.ts. */
export function useWorkflowWallet(detail: ProjectResponse, extra: { allowanceUnits?: bigint | null; amountUnits?: bigint } = {}) {
  const w = useArcWallet();
  const ctx: WalletContext = {
    roles: detail.viewer.roles,
    escrowConfigured: !!detail.chain.escrowAddress,
    connected: w.isConnected,
    onArc: w.onArc,
    allowanceUnits: extra.allowanceUnits ?? null,
    amountUnits: extra.amountUnits ?? 0n,
  };
  return { wallet: w, ctx };
}
