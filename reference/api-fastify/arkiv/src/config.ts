import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_ENTITY_DAYS = 30;
const MIN_ENTITY_DAYS = 1;
const MAX_ENTITY_DAYS = 365;
/**
 * Arkiv's longest lifetime is 7,884,000 blocks, about 182.5 days, and longer requests
 * throw InvalidExpiryError (docs: /reference/limits/). Larger configured values are
 * capped here. The real expiry always comes from what Arkiv returns.
 */
export const MAX_ARKIV_LIFETIME_DAYS = 182;

export type ArkivNotConfiguredReason =
  | "MISSING_ACCESS_KEY"
  | "INVALID_PRIVATE_KEY"
  | "INVALID_ENTITY_DAYS";

export type ArkivConfig =
  | { status: "disabled" }
  | { status: "not_configured"; reason: ArkivNotConfiguredReason }
  | {
      status: "ready";
      accessKey: string;
      privateKey: `0x${string}`;
      anchorAddress: string;
      entityDays: number;
    };

/** Reasons are codes only, so a key can never end up in a message. */
export const loadArkivConfig = (env: NodeJS.ProcessEnv = process.env): ArkivConfig => {
  if (env.ARKIV_ENABLED !== "true") return { status: "disabled" };

  const accessKey = env.ARKIV_ACCESS_KEY;
  if (!accessKey) return { status: "not_configured", reason: "MISSING_ACCESS_KEY" };

  const privateKey = env.ARKIV_PRIVATE_KEY;
  if (!privateKey || !isHex(privateKey) || privateKey.length !== 66) {
    return { status: "not_configured", reason: "INVALID_PRIVATE_KEY" };
  }

  const rawDays = env.ARKIV_ENTITY_DAYS;
  const days = rawDays ? Number(rawDays) : DEFAULT_ENTITY_DAYS;
  if (!Number.isInteger(days) || days < MIN_ENTITY_DAYS || days > MAX_ENTITY_DAYS) {
    return { status: "not_configured", reason: "INVALID_ENTITY_DAYS" };
  }

  return {
    status: "ready",
    accessKey,
    privateKey,
    anchorAddress: privateKeyToAccount(privateKey).address.toLowerCase(),
    entityDays: Math.min(days, MAX_ARKIV_LIFETIME_DAYS),
  };
};
