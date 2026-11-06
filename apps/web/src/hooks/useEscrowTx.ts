"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { ARC_TESTNET_CONFIG } from "@/lib/arc";
import { errorMessage } from "@/lib/format";

export type TxPhase = "idle" | "signing" | "confirming" | "syncing" | "done" | "error";

export interface TxState {
  phase: TxPhase;
  label: string;
  hash?: string;
  error?: string;
  /** Present when the transaction was sent but the server has not verified it yet. */
  canResync: boolean;
  /** False for wallet-only transactions (ERC-20 approve) that the server does not record. */
  verifies: boolean;
}

interface WriteArgs {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}
interface Prepared {
  write: WriteArgs;
  /** API path that verifies the transaction on the server. Omit for transactions with nothing to sync (ERC-20 approve). */
  syncPath?: string;
  syncBody?: Record<string, unknown>;
}
interface Pending {
  hash: string;
  label: string;
  syncPath: string;
  syncBody: Record<string, unknown>;
}

const RETRYABLE = ["RECEIPT_NOT_FOUND", "CHAIN_STATE_BEHIND"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const storageKey = (projectId: string) => `trustora:pending-sync:${projectId}`;

function readPending(projectId: string): Pending | null {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(projectId: string, p: Pending | null) {
  try {
    if (p) window.localStorage.setItem(storageKey(projectId), JSON.stringify(p));
    else window.localStorage.removeItem(storageKey(projectId));
  } catch {
    /* storage unavailable: the in-memory retry still works for this session */
  }
}

/**
 * Sign in the browser wallet -> wait for the Arc receipt -> ask the server to verify it.
 * The server alone decides what is recorded; a failed sync never re-signs, and the sent hash is kept for retry.
 */
export function useEscrowTx(projectId: string) {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: "idle", label: "", canResync: false, verifies: true });
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const p = readPending(projectId);
    if (p) {
      setPending(p);
      setState({ phase: "error", label: p.label, hash: p.hash, canResync: true, verifies: true, error: "A transaction was sent but not yet verified by the server. Sync it to update the project." });
    }
  }, [projectId]);

  const refresh = useCallback(() => queryClient.invalidateQueries(), [queryClient]);

  const sync = useCallback(
    async (p: Pending) => {
      setState({ phase: "syncing", label: p.label, hash: p.hash, canResync: false, verifies: true });
      for (let attempt = 0; ; attempt++) {
        try {
          await api(p.syncPath, { method: "POST", body: { ...p.syncBody, txHash: p.hash } });
          writePending(projectId, null);
          setPending(null);
          setState({ phase: "done", label: p.label, hash: p.hash, canResync: false, verifies: true });
          await refresh();
          return;
        } catch (e) {
          const code = e instanceof ApiError ? e.code : undefined;
          if (code && RETRYABLE.includes(code) && attempt < 7) {
            await sleep(2000);
            continue;
          }
          setState({ phase: "error", label: p.label, hash: p.hash, canResync: true, verifies: true, error: errorMessage(e) });
          return;
        }
      }
    },
    [projectId, refresh],
  );

  const run = useCallback(
    async (label: string, prepare: () => Promise<Prepared>) => {
      try {
        setState({ phase: "signing", label, canResync: false, verifies: true });
        const prepared = await prepare(); // e.g. store the deliverable text so its hash can be anchored
        const hash = await writeContractAsync({ ...prepared.write, chainId: ARC_TESTNET_CONFIG.id } as never);
        setState({ phase: "confirming", label, hash, canResync: false, verifies: !!prepared.syncPath });
        await waitForTransactionReceipt(config, { hash, chainId: ARC_TESTNET_CONFIG.id });
        if (!prepared.syncPath) {
          setState({ phase: "done", label, hash, canResync: false, verifies: false });
          await refresh();
          return;
        }
        const p: Pending = { hash, label, syncPath: prepared.syncPath, syncBody: prepared.syncBody ?? {} };
        writePending(projectId, p);
        setPending(p);
        await sync(p);
      } catch (e) {
        const msg = errorMessage(e);
        setState({
          phase: "error",
          label,
          canResync: false,
          verifies: true,
          error: /user rejected|denied|rejected the request/i.test(msg) ? "Cancelled in your wallet. Nothing was sent." : msg,
        });
      }
    },
    [config, projectId, refresh, sync, writeContractAsync],
  );

  const resync = useCallback(() => (pending ? sync(pending) : Promise.resolve()), [pending, sync]);
  const dismiss = useCallback(() => setState({ phase: "idle", label: "", canResync: false, verifies: true }), []);
  const busy = state.phase === "signing" || state.phase === "confirming" || state.phase === "syncing";

  return { state, busy, run, resync, dismiss };
}
