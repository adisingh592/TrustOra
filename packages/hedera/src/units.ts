/**
 * Money handling for Hedera payments. HBAR amounts are INTEGER TINYBARS (bigint) everywhere that matters:
 * policy decisions, caps, daily budgets, requirement comparison and verification. Floats are only ever
 * produced for display. 1 HBAR = 100,000,000 tinybars.
 */
export const TINYBARS_PER_HBAR = 100_000_000n;

/** Approved defaults. Configuration may only LOWER these caps, never raise them. */
export const DEFAULT_PAYMENT_TINYBARS = 10_000_000n; // 0.1 HBAR
export const MAX_PAYMENT_TINYBARS = 100_000_000n; // 1 HBAR per payment
export const MAX_DAILY_TINYBARS = 500_000_000n; // 5 HBAR per rolling 24 hours

/** Exact decimal HBAR string -> tinybars. Rejects negatives, junk and more than 8 decimal places. */
export function parseHbarToTinybars(hbar: string): bigint {
  const s = hbar.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error(`Invalid HBAR amount: ${hbar}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * TINYBARS_PER_HBAR + BigInt(frac.padEnd(8, "0"));
}

/** Tinybars -> exact decimal HBAR string (trailing zeros trimmed). Display only. */
export function formatTinybars(tinybars: bigint): string {
  const neg = tinybars < 0n;
  const abs = neg ? -tinybars : tinybars;
  const whole = abs / TINYBARS_PER_HBAR;
  const frac = (abs % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Parses an x402 `amount` field: a plain positive integer string in tinybars. Floats, exponents, signs,
 * leading zeros and whitespace are rejected, never coerced.
 */
export function parseTinybarsAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
  return BigInt(value);
}

/** A Hedera account ID in shard.realm.num form (aliases are not accepted as payment recipients). */
export const isHederaAccountId = (v: unknown): v is string => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
