import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createArkivAdapterFromEnv, loadArkivConfig } from "@trustora/arkiv";
import { createWalletAuthVerifier } from "@trustora/security";
import type { AnchorAdapter, EscrowAdapter, EvaluationAdapter } from "@trustora/shared";
import Fastify, { type FastifyServerOptions } from "fastify";
import { type AuthConfig, loadAuthConfig } from "./auth/config.js";
import { createPrismaNonceStore } from "./auth/nonceStore.js";
import { authRoutes, createRequireUser } from "./auth/routes.js";
import { createSessionCodec } from "./auth/session.js";
import { buildCorsOptions, parseWebOrigins } from "./cors.js";
import { prisma } from "./db.js";
import { infrastructureRoutes } from "./infrastructure/routes.js";
import { milestoneRoutes } from "./milestones/milestoneRoutes.js";
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
  /** Private storage directory for uploaded deliverables. */
  storageDir?: string;
  /** Defaults to WEB_ORIGIN (comma-separated). Only these origins may use the cookie-bearing API. */
  webOrigins?: string[];
  /** Defaults to TRUST_PROXY ("true" => true, anything else => false). */
  trustProxy?: boolean;
  /** For tests. */
  now?: () => Date;
}

export const buildApp = (options: BuildAppOptions = {}) => {
  const config = options.config ?? loadAuthConfig();
  const now = options.now ?? (() => new Date());
  const tokenAddress =
    options.tokenAddress !== undefined ? options.tokenAddress : loadTokenAddress();
  const webOrigins = options.webOrigins ?? parseWebOrigins(process.env.WEB_ORIGIN);
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";

  const app = Fastify({
    logger: options.logger ?? defaultLogger(),
    bodyLimit: 30 * 1024 * 1024,
    trustProxy,
  });
  app.decorateRequest("userId", null);
  app.register(cookie);
  // Only WEB_ORIGIN's origins may use this cookie-bearing API from a browser:
  // never a wildcard, and a request with no Origin header is unaffected.
  app.register(cors, buildCorsOptions(webOrigins));
  app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1,
    },
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ ok: true, database: "connected", timestamp: now().toISOString() });
    } catch {
      return reply.code(503).send({ ok: false, database: "disconnected", timestamp: now().toISOString() });
    }
  });

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
  app.register(milestoneRoutes, {
    prisma,
    requireUser,
    chainAdapter: options.chainAdapter ?? null,
    storageDir: options.storageDir,
    now,
  });
  app.register(infrastructureRoutes, {
    prisma,
    chainAdapter: options.chainAdapter ?? null,
    evaluationAdapter: options.evaluationAdapter ?? null,
    now,
  });
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
