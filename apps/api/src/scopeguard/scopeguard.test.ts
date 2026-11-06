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
import { computeScopeGuardReport, diffCriteria, diffMilestones } from "./scopeguard.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-scopeguard-test-"));
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

describe("ScopeGuard Unit Tests", () => {
  it("diffs criteria correctly for added and removed items", () => {
    const base = ["criterion 1", "criterion 2"];
    const target = ["criterion 2", "criterion 3"];
    const diffs = diffCriteria(base, target);

    expect(diffs).toEqual([
      { type: "UNCHANGED", criterion: "criterion 2" },
      { type: "ADDED", criterion: "criterion 3" },
      { type: "REMOVED", criterion: "criterion 1" },
    ]);
  });

  it("diffs milestones detecting deadline shifts and budget shifts", () => {
    const base = [
      {
        onchainMilestoneId: "0x1111",
        title: "Milestone 1",
        amountBaseUnits: "50000000",
        deadline: "2026-06-01T00:00:00.000Z",
        criteria: ["Build API"],
      },
    ];
    const target = [
      {
        onchainMilestoneId: "0x1111",
        title: "Milestone 1 (Updated)",
        amountBaseUnits: "75000000",
        deadline: "2026-06-08T00:00:00.000Z",
        criteria: ["Build API", "Add OAuth"],
      },
    ];

    const diffs = diffMilestones(base, target);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.type).toBe("MODIFIED");
    expect(diffs[0]?.deadlineShiftDays).toBe(7);
    expect(diffs[0]?.amountDeltaBaseUnits).toBe("25000000");
    expect(diffs[0]?.criteriaDiffs).toEqual([
      { type: "UNCHANGED", criterion: "Build API" },
      { type: "ADDED", criterion: "Add OAuth" },
    ]);
  });

  it("computes full ScopeGuard report with risk ratings", () => {
    const baseTerms = {
      publicProjectId: "TRU-PROJ-2026-0001042",
      title: "P",
      description: "D",
      clientWallet: "0x1",
      freelancerWallet: "0x2",
      arbiterWallet: "0x3",
      chainId: 5042002,
      tokenAddress: "0xtoken",
      tokenDecimals: 6,
      milestones: [
        {
          onchainMilestoneId: "0x1111",
          title: "M1",
          amountBaseUnits: "10000000",
          deadline: "2026-06-01T00:00:00.000Z",
          criteria: ["C1"],
        },
      ],
    };

    const targetTerms = {
      ...baseTerms,
      milestones: [
        {
          onchainMilestoneId: "0x1111",
          title: "M1",
          amountBaseUnits: "20000000", // +100% cost -> HIGH risk
          deadline: "2026-06-25T00:00:00.000Z", // +24 days -> HIGH risk
          criteria: ["C1", "C2"],
        },
      ],
    };

    const report = computeScopeGuardReport(
      "TRU-PROJ-2026-0001042",
      {
        version: 1,
        criteriaJson: JSON.stringify(baseTerms),
        clientAcceptedAt: new Date(),
        freelancerAcceptedAt: new Date(),
      },
      {
        version: 2,
        criteriaJson: JSON.stringify(targetTerms),
        clientAcceptedAt: null,
        freelancerAcceptedAt: null,
      },
    );

    expect(report.hasChanges).toBe(true);
    expect(report.timelineRisk).toBe("HIGH");
    expect(report.costRisk).toBe("HIGH");
    expect(report.overallRisk).toBe("HIGH");
    expect(report.approvalStatus.isFullyAccepted).toBe(false);
  });
});

describe("ScopeGuard API Routes", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/TRU-PROJ-2026-0001042/scopeguard",
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
    expect(projRes.statusCode).toBe(201);
    const project = projRes.json();

    const outsiderRes = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/scopeguard`,
      cookies: outsider.cookie,
    });
    expect(outsiderRes.statusCode).toBe(404);
  });

  it("returns ScopeGuard report for project participants comparing version 1 to version 1", async () => {
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
      url: `/projects/${project.id}/scopeguard`,
      cookies: client.cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publicProjectId).toBe(project.id);
    expect(body.baseVersion).toBe(1);
    expect(body.targetVersion).toBe(1);
    expect(body.hasChanges).toBe(false);
    expect(body.overallRisk).toBe("LOW");
  });

  it("detects scope changes when a new agreement version is proposed", async () => {
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
            criteria: ["Initial criteria"],
          },
        ],
      },
    });
    const project = projRes.json();
    const milestoneId = project.milestones[0].id;

    // Propose version 2 with an extra criterion and extended deadline
    const proposeRes = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/agreement/versions`,
      cookies: freelancer.cookie,
      payload: {
        milestones: [
          {
            id: milestoneId,
            title: "M1",
            amount: "60000000", // +10 USDC
            deadline: "2099-01-10T00:00:00.000Z", // +9 days
            criteria: ["Initial criteria", "Additional required feature"],
          },
        ],
      },
    });
    expect(proposeRes.statusCode).toBe(201);

    // Call ScopeGuard
    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/scopeguard?baseVersion=1&targetVersion=2`,
      cookies: client.cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasChanges).toBe(true);
    expect(body.baseVersion).toBe(1);
    expect(body.targetVersion).toBe(2);
    expect(body.totalAmountDeltaBaseUnits).toBe("10000000");
    expect(body.totalDeadlineShiftDays).toBe(9);
    expect(body.approvalStatus.isFullyAccepted).toBe(false);
    expect(body.milestoneDiffs[0].criteriaDiffs).toContainEqual({
      type: "ADDED",
      criterion: "Additional required feature",
    });
  });
});
