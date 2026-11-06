// `injected` is imported from "wagmi" (not "wagmi/connectors"): the connectors barrel drags in every optional SDK.
import { createConfig, http, injected } from "wagmi";
import { arcTestnetChain, getArcRpcUrl } from "./arc";

/**
 * Browser wallet configuration. Arc Testnet (chain 5042002) is the only chain; MetaMask is the connector.
 * Every fund-moving transaction is signed in the user's wallet: the app holds no keys.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnetChain],
  connectors: [injected({ target: "metaMask" })],
  transports: { [arcTestnetChain.id]: http(getArcRpcUrl()) },
  ssr: true,
});
