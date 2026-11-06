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
import { computeTrustShieldReport } from "./trustshield.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-trustshield-test-"));
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

describe("TrustShield Heuristic Unit Tests", () => {
  it("evaluates a timely project as LOW risk across all indicators", () => {
    const report = computeTrustShieldReport({
      publicProjectId: "TRU-PROJ-2026-0001042",
      projectStatus: "ACTIVE",
      milestones: [
        {
          id: "m1",
          title: "Milestone 1",
          deadline: new Date("2026-07-01T00:00:00.000Z"),
          status: "AGREED",
          agreementVersions: [{ version: 1 }],
          submissions: [],
        },
      ],
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(report.overallRisk).toBe("LOW");
    expect(report.deadlineAdherence.level).toBe("LOW");
    expect(report.scopeVolatility.level).toBe("LOW");
    expect(report.submissionHistory.level).toBe("LOW");
    expect(report.disputeHistory.level).toBe("LOW");
    expect(report.overallConfidence).toBeGreaterThanOrEqual(0.9);
    expect(report.heuristicNotes.length).toBeGreaterThan(0);
  });

  it("detects missed deadlines and marks deadlineAdherence as HIGH risk", () => {
    const report = computeTrustShieldReport({
      publicProjectId: "TRU-PROJ-2026-0001042",
      projectStatus: "ACTIVE",
      milestones: [
        {
          id: "m1",
          title: "Milestone 1",
          deadline: new Date("2026-05-01T00:00:00.000Z"), // Past!
          status: "AGREED",
          agreementVersions: [{ version: 1 }],
          submissions: [],
        },
        {
          id: "m2",
          title: "Milestone 2",
          deadline: new Date("2026-05-15T00:00:00.000Z"), // Past!
          status: "AGREED",
          agreementVersions: [{ version: 1 }],
          submissions: [],
        },
      ],
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(report.deadlineAdherence.level).toBe("HIGH");
    expect(report.overallRisk).toBe("HIGH");
  });

  it("detects high scope volatility when many versions exist", () => {
    const report = computeTrustShieldReport({
      publicProjectId: "TRU-PROJ-2026-0001042",
      projectStatus: "ACTIVE",
      milestones: [
        {
          id: "m1",
          title: "Milestone 1",
          deadline: new Date("2026-07-01T00:00:00.000Z"),
          status: "AGREED",
          agreementVersions: [
            { version: 1 },
            { version: 2 },
            { version: 3 },
            { version: 4 },
            { version: 5 },
          ],
          submissions: [],
        },
      ],
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(report.scopeVolatility.level).toBe("HIGH");
    expect(report.overallRisk).toBe("HIGH");
  });

  it("flags active disputes immediately as HIGH dispute risk", () => {
    const report = computeTrustShieldReport({
      publicProjectId: "TRU-PROJ-2026-0001042",
      projectStatus: "DISPUTED",
      milestones: [
        {
          id: "m1",
          title: "Milestone 1",
          deadline: new Date("2026-07-01T00:00:00.000Z"),
          status: "DISPUTED",
          agreementVersions: [{ version: 1 }],
          submissions: [],
        },
      ],
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(report.disputeHistory.level).toBe("HIGH");
    expect(report.overallRisk).toBe("HIGH");
  });
});

describe("TrustShield API Routes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/TRU-PROJ-2026-0001042/trustshield",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an outsider attempting to view TrustShield report", async () => {
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
      url: `/projects/${project.id}/trustshield`,
      cookies: outsider.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns TrustShield analysis report for project participant", async () => {
    const client = await signIn();
    const freelancer = await signIn();

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
      url: `/projects/${project.id}/trustshield`,
      cookies: freelancer.cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publicProjectId).toBe(project.id);
    expect(body.overallRisk).toBe("LOW");
    expect(body.deadlineAdherence.level).toBe("LOW");
    expect(body.scopeVolatility.level).toBe("LOW");
    expect(body.disputeHistory.level).toBe("LOW");
    expect(body.explanation).toBeTruthy();
  });
});
