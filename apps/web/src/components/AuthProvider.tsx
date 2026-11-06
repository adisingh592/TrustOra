"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { api } from "@/lib/api";
import { ARC_TESTNET_CONFIG } from "@/lib/arc";
import { buildLoginMessage } from "@/lib/siwe";
import { errorMessage } from "@/lib/format";
import type { AccountRole } from "@/lib/roles";

interface AuthContextValue {
  status: "loading" | "anonymous" | "authenticated";
  /** Wallet the server session belongs to (lowercase), or null. */
  sessionAddress: string | null;
  accountRole: AccountRole | null;
  /** True when a session exists but the connected wallet is a different account. */
  walletMismatch: boolean;
  busy: boolean;
  error: string | null;
  signIn: (role: AccountRole) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <Providers>");
  return ctx;
}

/**
 * Nonce + wallet signature login. The server verifies the signature, including the selected role,
 * and issues an HttpOnly session cookie. The browser never sees a session token.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ authenticated: boolean; address: string | null; role: AccountRole | null }>("/api/auth/session")
      .then((r) => {
        if (cancelled) return;
        setSessionAddress(r.address);
        setAccountRole(r.role);
        setStatus(r.authenticated ? "authenticated" : "anonymous");
      })
      .catch(() => !cancelled && setStatus("anonymous"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "authenticated" && address && sessionAddress && address.toLowerCase() !== sessionAddress) {
      void signOut();
    }
  }, [address, sessionAddress, status]);

  const signIn = useCallback(async (role: AccountRole) => {
    if (!address) {
      setError("Connect your wallet first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!isConnected || chainId !== ARC_TESTNET_CONFIG.id) {
        setError("Switch MetaMask to Arc Testnet before signing in");
        return;
      }
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce", { method: "POST", body: { address, role } });
      const now = new Date();
      const message = buildLoginMessage({
        domain: window.location.host,
        address,
        uri: window.location.origin,
        chainId: ARC_TESTNET_CONFIG.id,
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        role,
      });
      const signature = await signMessageAsync({ message });
      const r = await api<{ address: string }>("/api/auth/verify", { method: "POST", body: { message, signature } });
      setSessionAddress(r.address.toLowerCase());
      setAccountRole(role);
      setStatus("authenticated");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [address, chainId, isConnected, signMessageAsync]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      /* the cookie is cleared server-side when possible; fall through to local reset */
    } finally {
      setSessionAddress(null);
      setAccountRole(null);
      setStatus("anonymous");
      setBusy(false);
    }
  }, []);

  const walletMismatch =
    status === "authenticated" && isConnected && !!address && !!sessionAddress && address.toLowerCase() !== sessionAddress;

  const value = useMemo(
    () => ({ status, sessionAddress, accountRole, walletMismatch, busy, error, signIn, signOut }),
    [status, sessionAddress, accountRole, walletMismatch, busy, error, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
