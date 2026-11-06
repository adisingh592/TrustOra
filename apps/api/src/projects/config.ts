import { WalletAddressSchema } from "@trustora/shared";

/** The token address comes from configuration only. Throws if it is malformed. */
export const loadTokenAddress = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const value = env.ARC_TESTNET_USDC_ADDRESS;
  if (!value) return null;
  const parsed = WalletAddressSchema.safeParse(value);
  if (!parsed.success) throw new Error("ARC_TESTNET_USDC_ADDRESS is not a valid address.");
  return parsed.data;
};
