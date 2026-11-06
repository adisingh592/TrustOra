"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ARC_TESTNET_CONFIG } from "@/lib/arc";

/** Connected-wallet state plus the Arc Testnet network check, shared by the header and action panels. */
export function useArcWallet() {
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const configChainId = useChainId();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  const [hasProvider, setHasProvider] = useState(true);

  useEffect(() => {
    setMounted(true);
    setHasProvider(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum);
  }, []);

  const currentChainId = accountChainId ?? configChainId;
  return {
    mounted,
    hasProvider,
    address,
    isConnected: mounted && isConnected,
    onArc: mounted && isConnected && currentChainId === ARC_TESTNET_CONFIG.id,
    currentChainId,
    connecting,
    switching,
    error: connectError?.message ?? switchError?.message ?? null,
    connectMetaMask: () => {
      const connector = connectors[0];
      if (connector) connect({ connector, chainId: ARC_TESTNET_CONFIG.id });
    },
    switchToArc: () => switchChain({ chainId: ARC_TESTNET_CONFIG.id }),
    disconnect: () => disconnect(),
  };
}
