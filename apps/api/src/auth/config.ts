import { randomBytes } from "node:crypto";

const DEFAULT_AUTH_DOMAIN = "localhost:3001";
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  /** The only domain sign-in messages are accepted for. */
  domain: string;
  sessionSecret: string;
  isProduction: boolean;
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
  return {
    domain,
    // Outside production, a random secret just means sessions end on restart.
    sessionSecret: secret || randomBytes(32).toString("hex"),
    isProduction,
  };
};
