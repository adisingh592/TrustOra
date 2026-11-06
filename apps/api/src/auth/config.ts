import { randomBytes } from "node:crypto";

const DEFAULT_AUTH_DOMAIN = "localhost:3001";
const MIN_SECRET_LENGTH = 32;
const COOKIE_SAME_SITE_VALUES = ["lax", "none"] as const;
export type CookieSameSite = (typeof COOKIE_SAME_SITE_VALUES)[number];

export interface AuthConfig {
  /** The only domain sign-in messages are accepted for. */
  domain: string;
  sessionSecret: string;
  isProduction: boolean;
  /**
   * "none" only when the web app is on a different site. Forces the cookie Secure.
   * Optional so a hand-built AuthConfig (as every existing test passes) keeps the
   * old default behaviour: "lax", Secure only in production.
   */
  cookieSameSite?: CookieSameSite;
  cookieSecure?: boolean;
}

/** Throws in production if SESSION_SECRET is unsafe. The value is never included in the error. */
export const loadAuthConfig = (env: NodeJS.ProcessEnv = process.env): AuthConfig => {
  const isProduction = env.NODE_ENV === "production";
  const domain = env.AUTH_DOMAIN || DEFAULT_AUTH_DOMAIN;
  if (/\s/.test(domain)) throw new Error("AUTH_DOMAIN must not contain spaces.");

  const secret = env.SESSION_SECRET;
  if (isProduction && (!secret || secret.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `SESSION_SECRET is missing or under ${MIN_SECRET_LENGTH} characters. Refusing to start in production.`,
    );
  }

  const rawSameSite = (env.COOKIE_SAMESITE || "lax").toLowerCase();
  if (!COOKIE_SAME_SITE_VALUES.includes(rawSameSite as CookieSameSite)) {
    throw new Error('COOKIE_SAMESITE must be "lax" or "none" if set.');
  }
  const cookieSameSite = rawSameSite as CookieSameSite;

  return {
    domain,
    // Outside production, a random secret just means sessions end on restart.
    sessionSecret: secret || randomBytes(32).toString("hex"),
    isProduction,
    cookieSameSite,
    // SameSite=None requires Secure even outside production; a browser drops it otherwise.
    cookieSecure: isProduction || cookieSameSite === "none",
  };
};
