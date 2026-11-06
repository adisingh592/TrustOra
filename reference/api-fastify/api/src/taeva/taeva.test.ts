import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationAdapter, EvaluationInput, EvaluationResult } from "@trustora/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";
import { runTaevaEvaluation } from "./taeva.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-taeva-test-"));
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

describe("TAEVA Algorithm Unit Tests", () => {
  const baseInput = {
    milestoneId: "m1",
    milestoneTitle: "M1",
    milestoneDeadline: new Date("2026-06-10T00:00:00.000Z"),
    submissionId: "sub1",
    submissionFileHash: "a".repeat(64),
    submissionPrivateFilePath: "/tmp/nonexistent-file.zip",
    submissionAiConsent: true,
    submissionSubmittedAt: new Date("2026-06-05T00:00:00.000Z"),
    agreementCriteriaJson: JSON.stringify({
      milestones: [
        {
          title: "M1",
          criteria: ["Must satisfy unit tests", "Must include documentation"],
        },
      ],
    }),
    agreementClientAcceptedAt: new Date("2026-06-01T00:00:00.000Z"),
    agreementFreelancerAcceptedAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  it("passes all deterministic checks when deliverable is on time and agreed", async () => {
    const report = await runTaevaEvaluation(baseInput);

    expect(report.deterministicChecks.hashVerified).toBe(true);
    expect(report.deterministicChecks.deadlineMet).toBe(true);
    expect(report.deterministicChecks.agreementAccepted).toBe(true);
    expect(report.deterministicChecks.aiConsentGranted).toBe(true);
    expect(report.isAdvisory).toBe(true);
    expect(report.overallStatus).toBe("PASS");
    expect(report.criteriaResults).toHaveLength(2);
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags late submission in deterministic checks and marks status PARTIAL", async () => {
    const report = await runTaevaEvaluation({
      ...baseInput,
      submissionSubmittedAt: new Date("2026-06-15T00:00:00.000Z"), // Late!
    });

    expect(report.deterministicChecks.deadlineMet).toBe(false);
    expect(report.overallStatus).toBe("PARTIAL");
    expect(report.criteriaResults[0]?.status).toBe("PARTIAL");
  });

  it("integrates with an external EvaluationAdapter when available", async () => {
    const mockAdapter: EvaluationAdapter = {
      health: async () => ({
        status: "CONNECTED",
        detail: "0G mock healthy",
        checkedAt: new Date().toISOString(),
      }),
      evaluate: async (_input: EvaluationInput): Promise<EvaluationResult> => ({
        overall: "PASS",
        criteria: [
          { criterion: "Must satisfy unit tests", status: "PASS", evidence: "All tests pass" },
          { criterion: "Must include documentation", status: "PASS", evidence: "Docs present" },
        ],
        limitations: ["Advisory evaluation only"],
        suggestedRevisions: [],
        criteriaVersion: "v1",
        submissionHash: baseInput.submissionFileHash,
        modelId: "mock-0g-v1",
        promptHash: "p".repeat(64),
        requestId: "inf-req-99999",
        reportHash: "r".repeat(64),
      }),
    };

    const report = await runTaevaEvaluation({
      ...baseInput,
      evaluationAdapter: mockAdapter,
    });

    expect(report.requestId).toBe("inf-req-99999");
    expect(report.overallStatus).toBe("PASS");
    expect(report.criteriaResults[0]?.advisoryNotes).toContain("external inference adapter");
    expect(report.evaluationSource).toBe("ZERO_G_INFERENCE");
    expect(report.isAI).toBe(true);
  });

  it("R2 honesty: never fabricates an inference ID or claims AI ran when no adapter is usable", async () => {
    const report = await runTaevaEvaluation(baseInput);
    expect(report.evaluationSource).toBe("DETERMINISTIC_HEURISTIC");
    expect(report.isAI).toBe(false);
    expect(report.evaluationNote).toMatch(/no ai model was used/i);
    expect(report.requestId).toBe("");
  });

  it("R2 honesty: falls back honestly when the adapter is configured but unusable", async () => {
    const unhealthy: EvaluationAdapter = {
      health: async () => ({ status: "UNAVAILABLE", detail: "down", checkedAt: new Date().toISOString() }),
      evaluate: async () => {
        throw new Error("should never be called while unhealthy");
      },
    };
    const report = await runTaevaEvaluation({ ...baseInput, evaluationAdapter: unhealthy });
    expect(report.evaluationSource).toBe("DETERMINISTIC_HEURISTIC");
    expect(report.isAI).toBe(false);
  });
});

describe("TAEVA API Routes", () => {
  it("returns 404 for an outsider attempting to evaluate", async () => {
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
    const milestoneId = project.milestones[0].id;

    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/milestones/${milestoneId}/evaluate`,
      cookies: outsider.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when no submission exists for milestone", async () => {
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
    const milestoneId = project.milestones[0].id;

    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/milestones/${milestoneId}/evaluate`,
      cookies: client.cookie,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NO_SUBMISSION");
  });

  it("successfully evaluates a submitted deliverable and records evaluation & proof event", async () => {
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
            criteria: ["Complete implementation"],
          },
        ],
      },
    });
    const project = projRes.json();
    const milestoneId = project.milestones[0].id;

    // Both parties accept agreement version 1
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/agreement/accept`,
      cookies: client.cookie,
      payload: { version: 1 },
    });
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/agreement/accept`,
      cookies: freelancer.cookie,
      payload: { version: 1 },
    });

    // Create a submission record in DB
    const agreementVersion = await prisma.agreementVersion.findFirstOrThrow({
      where: { milestoneId, version: 1 },
    });
    const freelancerUser = await prisma.user.findUniqueOrThrow({
      where: { walletAddress: freelancer.address },
    });

    const fileHash = "e".repeat(64);
    const submission = await prisma.submission.create({
      data: {
        milestoneId,
        freelancerId: freelancerUser.id,
        agreementVersionId: agreementVersion.id,
        privateFilePath: "/tmp/deliverable.zip",
        fileHash,
        aiConsent: true,
        aiConsentAt: new Date(),
        status: "SUBMITTED",
      },
    });

    // Trigger TAEVA evaluation via POST. No evaluationAdapter is configured on this
    // app, so this exercises the deterministic heuristic fallback only.
    const evalRes = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/milestones/${milestoneId}/evaluate`,
      cookies: client.cookie,
    });
    expect(evalRes.statusCode).toBe(200);
    const report = evalRes.json();
    expect(report.milestoneId).toBe(milestoneId);
    expect(report.overallStatus).toBe("PASS");
    expect(report.isAdvisory).toBe(true);
    expect(report.deterministicChecks.hashVerified).toBe(true);
    expect(report.deterministicChecks.agreementAccepted).toBe(true);

    // R2 honesty: no AI ran, so the report must say so plainly, and no fabricated ID.
    expect(report.evaluationSource).toBe("DETERMINISTIC_HEURISTIC");
    expect(report.isAI).toBe(false);
    expect(report.evaluationNote).toMatch(/no ai model was used/i);
    expect(report.requestId).toBe("");

    // Verify Evaluation persisted in DB
    const savedEval = await prisma.evaluation.findFirst({
      where: { submissionId: submission.id },
    });
    expect(savedEval).not.toBeNull();
    expect(savedEval?.provider).toBe("TAEVA");

    // R2 honesty: the deterministic fallback has no chain or inference evidence,
    // so it must record NO ProofTrack event, VERIFIED or otherwise.
    const proofEvent = await prisma.proofEvent.findFirst({
      where: {
        publicProjectId: project.id,
        eventType: "EVALUATION_COMPLETED",
        referenceType: "INFERENCE_REQUEST_ID",
      },
    });
    expect(proofEvent).toBeNull();

    // Fetch evaluation via GET
    const getRes = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/milestones/${milestoneId}/evaluation`,
      cookies: freelancer.cookie,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().requestId).toBe(report.requestId);
  });

  it("records a VERIFIED ZERO_G ProofEvent only when a real 0G adapter actually produced the report", async () => {
    const client = await signIn();
    const freelancer = await signIn();
    const mockAdapter: EvaluationAdapter = {
      health: async () => ({ status: "CONNECTED", detail: "mock 0G", checkedAt: new Date().toISOString() }),
      evaluate: async (): Promise<EvaluationResult> => ({
        overall: "PASS",
        criteria: [{ criterion: "C1", status: "PASS", evidence: "ok" }],
        limitations: [],
        suggestedRevisions: [],
        criteriaVersion: "v1",
        submissionHash: "f".repeat(64),
        modelId: "mock-0g-v1",
        promptHash: "p".repeat(64),
        requestId: "inf-req-real-00001",
        reportHash: "r".repeat(64),
      }),
    };
    const realAdapterApp = buildApp({
      config,
      logger: false,
      tokenAddress: FIXTURE_TOKEN,
      now,
      evaluationAdapter: mockAdapter,
    });
    await realAdapterApp.ready();

    const projRes = await realAdapterApp.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "Test Project",
        description: "Test Description",
        freelancerWallet: freelancer.address,
        arbiterWallet: walletOnly(),
        milestones: [{ title: "M1", amount: "50000000", deadline: "2099-01-01T00:00:00.000Z", criteria: ["C1"] }],
      },
    });
    const project = projRes.json();
    const milestoneId = project.milestones[0].id;
    await realAdapterApp.inject({ method: "POST", url: `/projects/${project.id}/agreement/accept`, cookies: client.cookie, payload: { version: 1 } });
    await realAdapterApp.inject({ method: "POST", url: `/projects/${project.id}/agreement/accept`, cookies: freelancer.cookie, payload: { version: 1 } });

    const agreementVersion = await prisma.agreementVersion.findFirstOrThrow({ where: { milestoneId, version: 1 } });
    const freelancerUser = await prisma.user.findUniqueOrThrow({ where: { walletAddress: freelancer.address } });
    await prisma.submission.create({
      data: {
        milestoneId,
        freelancerId: freelancerUser.id,
        agreementVersionId: agreementVersion.id,
        privateFilePath: "/tmp/deliverable.zip",
        fileHash: "f".repeat(64),
        aiConsent: true,
        aiConsentAt: new Date(),
        status: "SUBMITTED",
      },
    });

    const evalRes = await realAdapterApp.inject({
      method: "POST",
      url: `/projects/${project.id}/milestones/${milestoneId}/evaluate`,
      cookies: client.cookie,
    });
    expect(evalRes.statusCode, evalRes.body).toBe(200);
    const report = evalRes.json();
    expect(report.evaluationSource).toBe("ZERO_G_INFERENCE");
    expect(report.isAI).toBe(true);
    expect(report.requestId).toBe("inf-req-real-00001");

    const proofEvent = await prisma.proofEvent.findFirst({
      where: { publicProjectId: project.id, eventType: "EVALUATION_COMPLETED", referenceType: "INFERENCE_REQUEST_ID" },
    });
    expect(proofEvent).not.toBeNull();
    expect(proofEvent?.verificationStatus).toBe("VERIFIED");
    expect(proofEvent?.ecosystem).toBe("ZERO_G");
    expect(proofEvent?.referenceValue).toBe("inf-req-real-00001");

    await realAdapterApp.close();
  });
});
