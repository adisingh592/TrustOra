"use client";

import { ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useArcWallet } from "@/hooks/useArcWallet";
import { Empty, PageSkeleton } from "./bits";

/** Renders children only for a connected wallet with a valid server session; otherwise says exactly what is missing. */
export function AuthGate({ children }: { children: ReactNode }) {
  const w = useArcWallet();
  const auth = useAuth();

  if (!w.mounted || auth.status === "loading") {
    return <PageSkeleton rows={2} />;
  }
  if (!w.isConnected) {
    return (
      <Empty title="Connect your wallet">
        <p className="mb-4 flex items-center justify-center gap-2"><Wallet className="h-4 w-4" /> TRUSTORA uses your MetaMask wallet to sign in and to sign every escrow transaction.</p>
        <button onClick={w.connectMetaMask} disabled={!w.hasProvider} className="rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          {w.hasProvider ? "Connect MetaMask" : "MetaMask not detected"}
        </button>
      </Empty>
    );
  }
  if (auth.status !== "authenticated" || auth.walletMismatch) {
    return (
      <Empty title={auth.walletMismatch ? "Sign in with the connected wallet" : "Sign in to continue"}>
        <p className="mb-4 flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4" /> Sign a message to prove you own this wallet. It costs no gas and cannot move funds.</p>
        <Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          <ShieldCheck className="h-4 w-4" /> Choose a role to continue
        </Link>
        {auth.error && <p className="mt-3 text-rose-700">{auth.error}</p>}
      </Empty>
    );
  }
  return <>{children}</>;
}
