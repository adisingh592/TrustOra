import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EscrowAdapter, EscrowState, VerifiedChainEvent } from "@trustora/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-milestones-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;
const storageDir = join(tempDir, "storage");

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const FIXTURE_ESCROW = `0x${"0".repeat(39)}2`;
const config: AuthConfig = {
  domain: "trustora.test",
  sessionSecret: "test-only-secret-".repeat(3),
  isProduction: false,
};
const DEADLINE = "2099-01-01T00:00:00.000Z";

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let app: ReturnType<typeof BuildApp>;

class TestMockChainAdapter implements EscrowAdapter {
  constructor(
    public chainEvent: Partial<VerifiedChainEvent> = {},
    public escrow: Partial<EscrowState> = {},
    public shouldFail = false,
  ) {}

  getConfig() {
    return {
      chainId: 5042002,
      rpcUrl: "https://testnet.arc.network/rpc",
      escrowAddress: FIXTURE_ESCROW,
      tokenAddress: FIXTURE_TOKEN,
      explorerBase: "https://testnet.arcscan.io",
    };
  }

  async verifyFunding(milestoneId: string, txHash: string): Promise<VerifiedChainEvent> {
    if (this.shouldFail) throw new Error("RPC error");
    return {
      txHash,
      chainId: 5042002,
      contractAddress: FIXTURE_ESCROW,
      milestoneId,
      amount: "50000000",
      token: FIXTURE_TOKEN,
      freelancer: `0x${"0".repeat(40)}`,
      agreementHash: `0x${"0".repeat(64)}`,
      blockNumber: 100,
      verified: true,
      ...this.chainEvent,
    };
  }

  async verifyRelease(milestoneId: string, txHash: string): Promise<VerifiedChainEvent> {
    if (this.shouldFail) throw new Error("RPC error");
    return {
      txHash,
      chainId: 5042002,
      contractAddress: FIXTURE_ESCROW,
      milestoneId,
      amount: "50000000",
      token: FIXTURE_TOKEN,
      freelancer: `0x${"0".repeat(40)}`,
      agreementHash: `0x${"0".repeat(64)}`,
      blockNumber: 101,
      verified: true,
      ...this.chainEvent,
    };
  }

  async readEscrow(milestoneId: string): Promise<EscrowState> {
    if (this.shouldFail) throw new Error("RPC error");
    return {
      milestoneId,
      client: `0x${"0".repeat(40)}`,
      freelancer: `0x${"0".repeat(40)}`,
      arbiter: `0x${"0".repeat(40)}`,
      token: FIXTURE_TOKEN,
      amount: "50000000",
      agreementHash: `0x${"0".repeat(64)}`,
      deadline: DEADLINE,
      status: "FUNDED",
      ...this.escrow,
    };
  }

  async health() {
    return {
      status: "CONNECTED" as const,
      detail: "MOCK adapter active for test",
      checkedAt: new Date().toISOString(),
    };
  }
}

const mockAdapter = new TestMockChainAdapter();

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("../db.js"));
  ({ buildApp } = await import("../app.js"));
  app = buildApp({
    config,
    logger: false,
    tokenAddress: FIXTURE_TOKEN,
    chainAdapter: mockAdapter,
    storageDir,
  });
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
  const nonceRes = await app.inject({
    method: "POST",
    url: "/auth/nonce",
    payload: { address: wallet.address },
  });
  const { message } = nonceRes.json() as { message: string };
  const signature = await wallet.signMessage({ message });
  const verifyRes = await app.inject({
    method: "POST",
    url: "/auth/verify-wallet",
    payload: { message, signature },
  });
  const cookieHeader = verifyRes.cookies.find((c) => c.name === SESSION_COOKIE);
  return {
    address: wallet.address.toLowerCase(),
    cookie: { [SESSION_COOKIE]: cookieHeader!.value },
  };
};

describe("Milestone End-to-End Demo Workflow", () => {
  it("runs the full lifecycle: agree -> fund -> upload -> submit-proof -> evaluate -> release -> verify", async () => {
    const client = await signIn();
    const freelancer = await signIn();
    const arbiter = await signIn();
    const outsider = await signIn();

    // 1. Create project
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "Test Demo Project",
        description: "Testing end-to-end milestone lifecycle",
        freelancerWallet: freelancer.address,
        arbiterWallet: arbiter.address,
        paymentMode: "ARC_ESCROW",
        milestones: [
          {
            title: "Milestone 1 Deliverable",
            amount: "50000000",
            deadline: DEADLINE,
            criteria: ["Responsive design works", "Unit tests pass"],
          },
        ],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const project = createRes.json();
    const publicProjectId = project.id;
    const milestoneId = project.milestones[0].id;
    const onchainMilestoneId = project.milestones[0].onchainMilestoneId;
    const agreementHash = project.agreement.agreementHash;

    // Outsider cannot access project
    const outsiderRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}`,
      cookies: outsider.cookie,
    });
    expect(outsiderRes.statusCode).toBe(404);

    // Arbiter is treated as an outsider on project agreement routes
    const arbiterReadRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}`,
      cookies: arbiter.cookie,
    });
    expect(arbiterReadRes.statusCode).toBe(404);

    // Both parties accept agreement
    await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/agreement/accept`,
      cookies: client.cookie,
      payload: { version: 1 },
    });
    const acceptRes2 = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/agreement/accept`,
      cookies: freelancer.cookie,
      payload: { version: 1 },
    });
    expect(acceptRes2.statusCode).toBe(200);
    expect(acceptRes2.json().status).toBe("AGREED");

    // Configure mock adapter with matching values
    mockAdapter.chainEvent = {
      chainId: 5042002,
      contractAddress: FIXTURE_ESCROW,
      milestoneId: onchainMilestoneId,
      amount: "50000000",
      token: FIXTURE_TOKEN,
      agreementHash,
      verified: true,
    };
    mockAdapter.escrow = {
      milestoneId: onchainMilestoneId,
      status: "FUNDED",
      amount: "50000000",
      token: FIXTURE_TOKEN,
      agreementHash,
    };

    // 2. Funding proof
    const fundingTxHash = "0x" + "11".repeat(32);
    const fundRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/funding-proof`,
      cookies: client.cookie,
      payload: { txHash: fundingTxHash },
    });
    expect(fundRes.statusCode).toBe(200);
    expect(fundRes.json().status).toBe("FUNDED");

    // Idempotent funding call with same tx hash
    const fundIdempotentRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/funding-proof`,
      cookies: client.cookie,
      payload: { txHash: fundingTxHash },
    });
    expect(fundIdempotentRes.statusCode).toBe(200);
    expect(fundIdempotentRes.json().alreadyProcessed).toBe(true);

    // 3. Deliverable upload (Freelancer only)
    const deliverablePayload = "console.log('deliverable code test');";
    const boundary = "---------------------------boundary123";
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="aiConsent"',
      "",
      "true",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="deliverable.ts"',
      "Content-Type: text/typescript",
      "",
      deliverablePayload,
      `--${boundary}--`,
    ].join("\r\n");

    const uploadRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/deliverable`,
      cookies: freelancer.cookie,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(multipartBody),
    });

    expect(uploadRes.statusCode).toBe(200);
    const uploadData = uploadRes.json();
    expect(uploadData.ok).toBe(true);
    expect(uploadData.fileHash).toBeDefined();
    expect(uploadData.aiConsent).toBe(true);
    const fileHash = uploadData.fileHash;

    // Deliverable download by client
    const downloadRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/deliverable`,
      cookies: client.cookie,
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.body).toBe(deliverablePayload);

    // Deliverable download by outsider fails
    const outsiderDownloadRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/deliverable`,
      cookies: outsider.cookie,
    });
    expect(outsiderDownloadRes.statusCode).toBe(404);

    // 4. Submit proof on chain
    mockAdapter.escrow.deliverableHash = fileHash;
    const submitTxHash = "0x" + "22".repeat(32);
    const submitRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/submit-proof`,
      cookies: freelancer.cookie,
      payload: { txHash: submitTxHash },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe("WORK_SUBMITTED");

    // 5. Evaluate milestone
    const evalRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/evaluate`,
      cookies: client.cookie,
    });
    expect(evalRes.statusCode).toBe(200);
    const evalData = evalRes.json();
    expect(evalData.evaluationSource).toBeDefined();
    expect(evalData.isAI).toBe(false); // mock heuristic has isAI: false
    expect(evalData.requestId).toBe(""); // heuristic has empty requestId

    // Arbiter can read evaluation
    const arbiterEvalRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/evaluation`,
      cookies: arbiter.cookie,
    });
    expect(arbiterEvalRes.statusCode).toBe(200);

    // 6. Release proof
    // Freelancer cannot release to themselves
    const freelancerReleaseRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/release-proof`,
      cookies: freelancer.cookie,
      payload: { txHash: "0x" + "33".repeat(32) },
    });
    expect(freelancerReleaseRes.statusCode).toBe(403);

    // Client releases
    mockAdapter.escrow.status = "RELEASED";
    const releaseTxHash = "0x" + "33".repeat(32);
    const releaseRes = await app.inject({
      method: "POST",
      url: `/projects/${publicProjectId}/milestones/${milestoneId}/release-proof`,
      cookies: client.cookie,
      payload: { txHash: releaseTxHash },
    });
    expect(releaseRes.statusCode).toBe(200);
    expect(releaseRes.json().status).toBe("RELEASED");

    // 7. Check ProofTrack timeline
    const timelineRes = await app.inject({
      method: "GET",
      url: `/projects/${publicProjectId}/prooftrack`,
      cookies: client.cookie,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = timelineRes.json().events;
    expect(timeline.length).toBeGreaterThanOrEqual(4);

    // 8. Public verify endpoint (no auth required)
    const publicVerifyRes = await app.inject({
      method: "GET",
      url: `/verify/${publicProjectId}`,
    });
    expect(publicVerifyRes.statusCode).toBe(200);
    const publicData = publicVerifyRes.json();
    expect(publicData.publicProjectId).toBe(publicProjectId);
    expect(publicData.status).toBe("COMPLETED");
    expect(publicData.milestones[0].status).toBe("RELEASED");
    expect(publicData.proofTimeline.length).toBeGreaterThanOrEqual(4);
    // Verifies no private file paths or secrets leaked in public response
    expect(JSON.stringify(publicData)).not.toContain(".storage");
    expect(JSON.stringify(publicData)).not.toContain("cookie");

    // 9. Infrastructure endpoint
    const infraRes = await app.inject({
      method: "GET",
      url: "/infrastructure",
    });
    expect(infraRes.statusCode).toBe(200);
    const infra = infraRes.json();
    expect(infra.arc.status).toBe("CONNECTED");
    expect(infra.hedera.status).toBe("NOT_CONFIGURED");

    // 10. Readiness check
    const readyRes = await app.inject({
      method: "GET",
      url: "/ready",
    });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().database).toBe("connected");
  });

  it("handles negative cases: missing consent, hash mismatch, outsider 404, wrong roles", async () => {
    const client = await signIn();
    const freelancer = await signIn();
    const arbiter = await signIn();
    const outsider = await signIn();

    // Create project
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "Negative Cases Project",
        description: "Testing error cases",
        freelancerWallet: freelancer.address,
        arbiterWallet: arbiter.address,
        paymentMode: "ARC_ESCROW",
        milestones: [
          {
            title: "M1",
            amount: "50000000",
            deadline: DEADLINE,
            criteria: ["Criteria 1"],
          },
        ],
      },
    });
    const proj = createRes.json();
    const pid = proj.id;
    const mid = proj.milestones[0].id;
    const onchainId = proj.milestones[0].onchainMilestoneId;

    // 1. Funding when in DRAFT (unagreed) should fail with 400
    const unagreedFundRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/funding-proof`,
      cookies: client.cookie,
      payload: { txHash: "0x" + "11".repeat(32) },
    });
    expect(unagreedFundRes.statusCode).toBe(400);
    expect(unagreedFundRes.json().error.code).toBe("MILESTONE_NOT_AGREED");

    // Agree
    await app.inject({
      method: "POST",
      url: `/projects/${pid}/agreement/accept`,
      cookies: client.cookie,
      payload: { version: 1 },
    });
    await app.inject({
      method: "POST",
      url: `/projects/${pid}/agreement/accept`,
      cookies: freelancer.cookie,
      payload: { version: 1 },
    });

    // 2. Funding mismatch (wrong amount)
    mockAdapter.chainEvent = {
      chainId: 5042002,
      contractAddress: FIXTURE_ESCROW,
      milestoneId: onchainId,
      amount: "99999999", // Mismatch!
      token: FIXTURE_TOKEN,
      agreementHash: proj.agreement.agreementHash,
      verified: true,
    };
    mockAdapter.escrow = {
      milestoneId: onchainId,
      status: "FUNDED",
      amount: "99999999",
      token: FIXTURE_TOKEN,
      agreementHash: proj.agreement.agreementHash,
    };

    const mismatchFundRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/funding-proof`,
      cookies: client.cookie,
      payload: { txHash: "0x" + "55".repeat(32) },
    });
    expect(mismatchFundRes.statusCode).toBe(400);
    expect(mismatchFundRes.json().error.code).toBe("FUNDING_MISMATCH");

    // Now fund properly
    mockAdapter.chainEvent.amount = "50000000";
    mockAdapter.escrow.amount = "50000000";
    const okFund = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/funding-proof`,
      cookies: client.cookie,
      payload: { txHash: "0x" + "77".repeat(32) },
    });
    expect(okFund.statusCode).toBe(200);

    // 3. Upload by client (only freelancer can upload)
    const boundary = "---------------------------boundary999";
    const bodyNoConsent = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="aiConsent"',
      "",
      "false", // Explicit NO consent
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="deliverable.ts"',
      "Content-Type: text/typescript",
      "",
      "console.log('no consent deliverable');",
      `--${boundary}--`,
    ].join("\r\n");

    const clientUploadRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/deliverable`,
      cookies: client.cookie,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(bodyNoConsent),
    });
    expect(clientUploadRes.statusCode).toBe(404);

    // Upload with NO AI consent
    const flUploadRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/deliverable`,
      cookies: freelancer.cookie,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(bodyNoConsent),
    });
    expect(flUploadRes.statusCode).toBe(200);
    expect(flUploadRes.json().aiConsent).toBe(false);

    // 4. Evaluate with NO AI consent should fail with AI_CONSENT_REQUIRED
    const evalNoConsentRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/evaluate`,
      cookies: client.cookie,
    });
    expect(evalNoConsentRes.statusCode).toBe(400);
    expect(evalNoConsentRes.json().error.code).toBe("AI_CONSENT_REQUIRED");

    // 5. Submit proof with deliverable hash mismatch
    mockAdapter.escrow.deliverableHash = "0x" + "99".repeat(32); // Mismatch!
    const submitMismatchRes = await app.inject({
      method: "POST",
      url: `/projects/${pid}/milestones/${mid}/submit-proof`,
      cookies: freelancer.cookie,
      payload: { txHash: "0x" + "44".repeat(32) },
    });
    expect(submitMismatchRes.statusCode).toBe(400);
    expect(submitMismatchRes.json().error.code).toBe("DELIVERABLE_HASH_MISMATCH");

    // 6. Outsider getting deliverable gets 404
    const outsiderGetDeliv = await app.inject({
      method: "GET",
      url: `/projects/${pid}/milestones/${mid}/deliverable`,
      cookies: outsider.cookie,
    });
    expect(outsiderGetDeliv.statusCode).toBe(404);
  });
});
