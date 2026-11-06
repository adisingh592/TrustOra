import cookie from "@fastify/cookie";
import { createWalletAuthVerifier } from "@trustora/security";
import type { EscrowAdapter } from "@trustora/shared";
import Fastify, { type FastifyServerOptions } from "fastify";
import { type AuthConfig, loadAuthConfig } from "./auth/config.js";
import { createPrismaNonceStore } from "./auth/nonceStore.js";
import { authRoutes, createRequireUser } from "./auth/routes.js";
import { createSessionCodec } from "./auth/session.js";
import { prisma } from "./db.js";
import { loadTokenAddress } from "./projects/config.js";
import { projectRoutes } from "./projects/routes.js";
import { proofTrackRoutes } from "./prooftrack/routes.js";

export const LOG_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "headers.cookie",
  "headers.authorization",
  'res.headers["set-cookie"]',
  'headers["set-cookie"]',
  "signature",
  "*.signature",
];

const defaultLogger = (): FastifyServerOptions["logger"] =>
  process.env.NODE_ENV === "test" ? false : { redact: LOG_REDACT_PATHS };

export interface BuildAppOptions {
  config?: AuthConfig;
  logger?: FastifyServerOptions["logger"];
  /** Defaults to ARC_TESTNET_USDC_ADDRESS. */
  tokenAddress?: string | null;
  /** No real chain adapter exists yet, so ProofTrack events stay PENDING by default. */
  chainAdapter?: EscrowAdapter | null;
  /** For tests. */
  now?: () => Date;
}

export const buildApp = (options: BuildAppOptions = {}) => {
  const config = options.config ?? loadAuthConfig();
  const now = options.now ?? (() => new Date());
  const tokenAddress =
    options.tokenAddress !== undefined ? options.tokenAddress : loadTokenAddress();

  const app = Fastify({ logger: options.logger ?? defaultLogger() });
  app.decorateRequest("userId", null);
  app.register(cookie);

  app.get("/health", async () => ({ ok: true }));

  const sessions = createSessionCodec(config.sessionSecret, now);
  const verifier = createWalletAuthVerifier({
    domain: config.domain,
    store: createPrismaNonceStore(prisma),
    now,
  });
  const requireUser = createRequireUser(sessions);
  app.register(authRoutes, { prisma, verifier, sessions, config, requireUser });
  app.register(projectRoutes, { prisma, requireUser, tokenAddress, now });
  app.register(proofTrackRoutes, {
    prisma,
    requireUser,
    chainAdapter: options.chainAdapter ?? null,
    now,
  });

  return Object.assign(app, { requireUser });
};
