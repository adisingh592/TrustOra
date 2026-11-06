"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ARC_TESTNET_CONFIG } from "@/lib/arc";
import { walletProviderError } from "@/lib/wallet-errors";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
};

/** Connected-wallet state plus the Arc Testnet network check, shared by the header and action panels. */
export function useArcWallet() {
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const configChainId = useChainId();
  const { connectAsync, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setHasProvider(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum);
  }, []);

  const connectMetaMask = useCallback(async () => {
    const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
    if (!ethereum) {
      setLocalError("MetaMask was not detected in this browser.");
      return;
    }
    setLocalError(null);
    try {
      const permitted = await ethereum.request({ method: "eth_accounts" }) as string[];
      if (!Array.isArray(permitted)) throw new Error("MetaMask returned an invalid account list.");
      if (isConnected) {
        const selected = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
        if (!Array.isArray(selected) || !selected[0]) throw new Error("MetaMask did not return a selected account.");
        return;
      }
      const connector = connectors.find((candidate) => candidate.id === "injected") ?? connectors[0];
      if (!connector) throw new Error("No browser wallet connector is available.");
      // connectAsync is only called from the user's button action; wagmi performs eth_requestAccounts
      // when the site has no authorized account and returns the account selected by MetaMask.
      const result = await connectAsync({ connector, chainId: ARC_TESTNET_CONFIG.id });
      const selected = result.accounts?.[0];
      if (!selected) throw new Error("MetaMask did not return a selected account.");
    } catch (error) {
      setLocalError(walletProviderError(error));
    }
  }, [connectAsync, connectors, isConnected]);

  useEffect(() => {
    const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
    if (!ethereum?.on) return;
    const onAccountsChanged = () => setLocalError(null);
    const onChainChanged = () => setLocalError(null);
    ethereum.on("accountsChanged", onAccountsChanged);
    ethereum.on("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
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
    error: localError ?? connectError?.message ?? switchError?.message ?? null,
    connectMetaMask,
    switchToArc: async () => {
      setLocalError(null);
      try {
        await switchChain({ chainId: ARC_TESTNET_CONFIG.id });
      } catch (error) {
        setLocalError(walletProviderError(error));
      }
    },
    disconnect: () => disconnect(),
  };
}
