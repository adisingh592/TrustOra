import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";
import { buildUnifiedTrustReport } from "./report.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-trustreport-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const config: AuthConfig = {
  domain: "trustora.test",
  sessionSecret: "test-only-secret-".repeat(3),
  isProduction: false,
};

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let app: ReturnType<typeof BuildApp>;
const now = () => new Date("2026-06-01T00:00:00.000Z");

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("../db.js"));
  ({ buildApp } = await import("../app.js"));
  app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, now });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

interface Actor {
  address: string;
  cookie: Record<string, string>;
}

const signIn = async (): Promise<Actor> => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const nonce = await app.inject({
    method: "POST",
    url: "/auth/nonce",
    payload: { address: wallet.address },
  });
  const { message } = nonce.json();
  const res = await app.inject({
    method: "POST",
    url: "/auth/verify-wallet",
    payload: { message, signature: await wallet.signMessage({ message }) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return {
    address: wallet.address.toLowerCase(),
    cookie: { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
  };
};

const walletOnly = () => privateKeyToAccount(generatePrivateKey()).address;

describe("Unified Trust Report Unit Tests", () => {
  it("builds a unified trust report with deterministic report hash", () => {
    const report = buildUnifiedTrustReport({
      publicProjectId: "TRU-PROJ-2026-0001042",
      paymentMode: "ARC_ESCROW",
      projectStatus: "ACTIVE",
      now: new Date("2026-06-01T00:00:00.000Z"),
      evaluations: [],
      totalMilestones: 1,
      totalVersions: 1,
      activeVersion: 1,
      hasPendingProposals: false,
      trustShieldReport: {
        publicProjectId: "TRU-PROJ-2026-0001042",
        evaluatedAt: "2026-06-01T00:00:00.000Z",
        deadlineAdherence: { level: "LOW", reason: "On schedule" },
        scopeVolatility: { level: "LOW", reason: "Stable scope" },
        submissionHistory: { level: "LOW", reason: "Good history" },
        disputeHistory: { level: "LOW", reason: "No disputes" },
        overallRisk: "LOW",
        overallConfidence: 0.95,
        explanation: "Low risk project",
        heuristicNotes: ["Advisory"],
      },
      proofTrackEvents: [
        { verificationStatus: "VERIFIED", ecosystem: "ARC" },
        { verificationStatus: "PENDING", ecosystem: "ZERO_G" },
      ],
    });

    expect(report.publicProjectId).toBe("TRU-PROJ-2026-0001042");
    expect(report.paymentMode).toBe("ARC_ESCROW");
    expect(report.verifiableReportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.proofTrackSummary.totalEvents).toBe(2);
    expect(report.proofTrackSummary.verifiedCount).toBe(1);
    expect(report.proofTrackSummary.pendingCount).toBe(1);
    expect(report.proofTrackSummary.ecosystemsInvolved).toEqual(["ARC", "ZERO_G"]);
    expect(report.disclaimer).toContain("advisory trust and verification report");
  });
});

describe("Unified Trust Report API Routes", () => {
  it("rejects unauthenticated request with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/TRU-PROJ-2026-0001042/trust-report",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an outsider participant (SEC-001)", async () => {
    const client = await signIn();
    const freelancer = await signIn();
    const outsider = await signIn();

    const projRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "Test Project",
        description: "Test Description",
        freelancerWallet: freelancer.address,
        arbiterWallet: walletOnly(),
        milestones: [
          {
            title: "M1",
            amount: "50000000",
            deadline: "2099-01-01T00:00:00.000Z",
            criteria: ["C1"],
          },
        ],
      },
    });
    const project = projRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/trust-report`,
      cookies: outsider.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a comprehensive unified trust report for an ARC_ESCROW project", async () => {
    const client = await signIn();
    const freelancer = await signIn();

    const projRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "Escrow Project",
        description: "Test Description",
        freelancerWallet: freelancer.address,
        arbiterWallet: walletOnly(),
        milestones: [
          {
            title: "M1",
            amount: "50000000",
            deadline: "2099-01-01T00:00:00.000Z",
            criteria: ["C1"],
          },
        ],
      },
    });
    const project = projRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/trust-report`,
      cookies: client.cookie,
    });
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.publicProjectId).toBe(project.id);
    expect(report.paymentMode).toBe("ARC_ESCROW");
    expect(report.taevaSummary.totalMilestones).toBe(1);
    expect(report.scopeGuardSummary.totalVersions).toBe(1);
    expect(report.trustShieldSummary.overallRisk).toBe("LOW");
    expect(report.verifiableReportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.disclaimer).toBeTruthy();
  });

  it("returns a comprehensive unified trust report for an EXTERNAL_PAYMENT project", async () => {
    const client = await signIn();
    const freelancer = await signIn();

    const projRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "External Payment Project",
        description: "Test Description",
        freelancerWallet: freelancer.address,
        arbiterWallet: walletOnly(),
        paymentMode: "EXTERNAL_PAYMENT",
        milestones: [
          {
            title: "M1",
            amount: "50000000",
            deadline: "2099-01-01T00:00:00.000Z",
            criteria: ["C1"],
          },
        ],
      },
    });
    const project = projRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/trust-report`,
      cookies: freelancer.cookie,
    });
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.publicProjectId).toBe(project.id);
    expect(report.paymentMode).toBe("EXTERNAL_PAYMENT");
    expect(report.verifiableReportHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
