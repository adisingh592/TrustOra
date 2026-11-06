export function walletProviderError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: number }).code : undefined;
  if (code === 4001) return "MetaMask connection was cancelled.";
  if (code === 4100) return "MetaMask has not authorized this site. Unlock MetaMask and approve this site connection.";
  if (code === 4900) return "MetaMask is disconnected. Reconnect the wallet and try again.";
  if (code === 4901) return "MetaMask is disconnected from this network. Switch to Arc Testnet.";
  return error instanceof Error ? error.message : "Could not connect to MetaMask.";
}
