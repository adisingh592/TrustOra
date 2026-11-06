import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import { createArkivAdapterFromEnv, loadArkivConfig } from "@trustora/arkiv";
import { createWalletAuthVerifier } from "@trustora/security";
import type { AnchorAdapter, EscrowAdapter, EvaluationAdapter } from "@trustora/shared";
import Fastify, { type FastifyServerOptions } from "fastify";
import { type AuthConfig, loadAuthConfig } from "./auth/config.js";
import { createPrismaNonceStore } from "./auth/nonceStore.js";
import { authRoutes, createRequireUser } from "./auth/routes.js";
import { createSessionCodec } from "./auth/session.js";
import { prisma } from "./db.js";
import { loadTokenAddress } from "./projects/config.js";
import { projectRoutes } from "./projects/routes.js";
import { anchorRoutes } from "./prooftrack/anchorRoutes.js";
import { proofTrackRoutes } from "./prooftrack/routes.js";
import { scopeGuardRoutes } from "./scopeguard/routes.js";
import { taevaRoutes } from "./taeva/routes.js";
import { trustReportRoutes } from "./trustreport/routes.js";
import { trustShieldRoutes } from "./trustshield/routes.js";

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
  /** Defaults to what ARKIV_* configures. Null or undefined turns anchoring off. */
  anchorAdapter?: AnchorAdapter | null;
  /** Optional evaluation adapter for TAEVA advisory AI assessment. */
  evaluationAdapter?: EvaluationAdapter | null;
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

  const webIndexPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/index.html");
  app.get("/", async (_request, reply) => {
    if (existsSync(webIndexPath)) {
      return reply.type("text/html").send(readFileSync(webIndexPath, "utf-8"));
    }
    return reply.send({ ok: true, name: "TrustOra API" });
  });

  const sessions = createSessionCodec(config.sessionSecret, now);
  const verifier = createWalletAuthVerifier({
    domain: config.domain,
    store: createPrismaNonceStore(prisma),
    now,
  });
  const requireUser = createRequireUser(sessions);
  app.register(authRoutes, { prisma, verifier, sessions, config, requireUser });
  app.register(projectRoutes, { prisma, requireUser, tokenAddress, now });
  const anchorAdapter =
    options.anchorAdapter !== undefined
      ? (options.anchorAdapter ?? undefined)
      : createArkivAdapterFromEnv();
  const arkiv = loadArkivConfig();
  if (options.anchorAdapter === undefined && arkiv.status === "not_configured") {
    // A reason code only: never a key.
    app.log.warn({ arkivReason: arkiv.reason }, "Arkiv is enabled but not configured, so it stays off");
  }
  app.register(proofTrackRoutes, {
    prisma,
    requireUser,
    chainAdapter: options.chainAdapter ?? null,
    anchorAdapter,
    now,
  });
  app.register(anchorRoutes, { prisma, requireUser, anchorAdapter, now });
  app.register(scopeGuardRoutes, { prisma, requireUser });
  app.register(taevaRoutes, {
    prisma,
    requireUser,
    evaluationAdapter: options.evaluationAdapter ?? null,
    now,
  });
  app.register(trustShieldRoutes, { prisma, requireUser, now });
  app.register(trustReportRoutes, { prisma, requireUser, now });

  return Object.assign(app, { requireUser });
};
