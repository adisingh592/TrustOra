// `injected` is imported from "wagmi" (not "wagmi/connectors"): the connectors barrel drags in every optional SDK.
import { createConfig, fallback, http, injected } from "wagmi";
import { arcTestnetChain, getArcRpcUrls } from "./arc";

/**
 * Browser wallet configuration. Arc Testnet (chain 5042002) is the only chain; MetaMask is the connector.
 * Uses fallback RPC transports with automatic retry and backoff against testnet rate limits.
 * Every fund-moving transaction is signed in the user's wallet: the app holds no keys.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnetChain],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [arcTestnetChain.id]: fallback(
      getArcRpcUrls().map((url) => http(url, { retryCount: 3, retryDelay: 1000 })),
    ),
  },
  ssr: true,
});
