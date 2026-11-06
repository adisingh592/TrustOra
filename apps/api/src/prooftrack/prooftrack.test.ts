import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProofTrack, MOCK_ChainAdapter } from "@trustora/prooftrack";
import type { VerifiedChainEvent } from "@trustora/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";
import { buildVerifiers } from "./routes.js";
import { createPrismaEventStore } from "./store.js";

// Runs the real migrations against a temporary database, never dev.db.
// Wallets are throwaway viem keys, and chain data comes from MOCK_ChainAdapter.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-prooftrack-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const FIXTURE_ESCROW = `0x${"0".repeat(39)}2`;
const AGREEMENT = "c".repeat(64);
const config: AuthConfig = {
  domain: "trustora.test",
  sessionSecret: "test-only-secret-".repeat(3),
  isProduction: false,
};

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let app: ReturnType<typeof BuildApp>;
let current: Date;
const now = () => current;

let txCounter = 0;
const nextTx = () => {
  txCounter += 1;
  return `0x${txCounter.toString(16).padStart(64, "a")}`;
};

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

beforeEach(() => {
  current = new Date();
});

interface Actor {
  address: string;
  cookie: Record<string, string>;
}

const signIn = async (target = app): Promise<Actor> => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const nonce = await target.inject({ method: "POST", url: "/auth/nonce", payload: { address: wallet.address } });
  const { message } = nonce.json();
  const res = await target.inject({
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

const setup = async (target = app) => {
  const client = await signIn(target);
  const freelancer = await signIn(target);
  const res = await target.inject({
    method: "POST",
    url: "/projects",
    cookies: client.cookie,
    payload: {
      title: "FIXTURE project",
      description: "FIXTURE description",
      freelancerWallet: freelancer.address,
      arbiterWallet: walletOnly(),
      milestones: [
        { title: "FIXTURE", amount: "50000000", deadline: "2099-01-01T00:00:00.000Z", criteria: ["FIXTURE"] },
      ],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const project = res.json();
  return { client, freelancer, project, url: `/projects/${project.id}/prooftrack` };
};

/** Server-side recording, the only way an event can be created. */
const tracker = () => createProofTrack({ store: createPrismaEventStore(prisma), now });

const recordFunded = (publicProjectId: string, freelancer: string, onchainMilestoneId: string, referenceValue = nextTx()) =>
  tracker().recordEvent({
    publicProjectId,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ecosystem: "ARC",
    network: "Arc Testnet",
    chainId: 5042002,
    eventType: "MILESTONE_FUNDED",
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue,
    expected: {
      onchainMilestoneId,
      amountBaseUnits: "50000000",
      tokenAddress: FIXTURE_TOKEN,
      freelancerWallet: freelancer,
      agreementHash: AGREEMENT,
    },
  });

const recordInference = (publicProjectId: string) =>
  tracker().recordEvent({
    publicProjectId,
    occurredAt: "2026-01-02T00:00:00.000Z",
    ecosystem: "ZERO_G",
    network: "FIXTURE_NETWORK",
    eventType: "EVALUATION_COMPLETED",
    referenceType: "INFERENCE_REQUEST_ID",
    referenceValue: `FIXTURE_request_${nextTx().slice(-12)}`,
  });

const get = (actor: Actor | null, url: string) =>
  app.inject({ method: "GET", url, ...(actor ? { cookies: actor.cookie } : {}) });
const post = (actor: Actor | null, url: string) =>
  app.inject({ method: "POST", url, ...(actor ? { cookies: actor.cookie } : {}) });

const FAKE_URL = "/projects/TRU-PROJ-2026-0000000/prooftrack";

describe("access", () => {
  const routes: [string, "GET" | "POST", string][] = [
    ["timeline", "GET", FAKE_URL],
    ["verify all", "POST", `${FAKE_URL}/verify`],
    ["verify one", "POST", `${FAKE_URL}/events/some-id/verify`],
  ];

  it.each(routes)("returns 401 without a session: %s", async (_label, method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it.each(routes.filter(([, method]) => method === "POST"))(
    "returns 401 for malformed JSON without a session: %s",
    async (_label, method, url) => {
      const res = await app.inject({
        method,
        url,
        headers: { "content-type": "application/json" },
        payload: "{not json",
      });
      expect(res.statusCode).toBe(401);
    },
  );

  it("an outsider gets 404 on all three routes, and a participant gets 200", async () => {
    const { client, freelancer, project, url } = await setup();
    const event = await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    const outsider = await signIn();

    const outsiderResponses = [
      await get(outsider, url),
      await post(outsider, `${url}/verify`),
      await post(outsider, `${url}/events/${event.id}/verify`),
    ];
    for (const res of outsiderResponses) expect(res.statusCode, res.body).toBe(404);

    expect((await get(client, url)).statusCode).toBe(200);
    expect((await get(freelancer, url)).statusCode).toBe(200);
    expect((await post(client, `${url}/verify`)).statusCode).toBe(200);
    current = new Date(current.getTime() + 10_000);
    expect((await post(freelancer, `${url}/events/${event.id}/verify`)).statusCode).toBe(200);
  });

  it("an outsider's 404 is identical to a missing or malformed project", async () => {
    const { url } = await setup();
    const outsider = await signIn();
    const hidden = await get(outsider, url);
    const missing = await get(outsider, FAKE_URL);
    const malformed = await get(outsider, "/projects/not-an-id/prooftrack");
    expect(hidden.body).toBe(missing.body);
    expect(hidden.body).toBe(malformed.body);
  });

  it("malformed JSON with a session gets a fixed 400, with no parser details", async () => {
    const { client, url } = await setup();
    const res = await app.inject({
      method: "POST",
      url: `${url}/verify`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
      cookies: client.cookie,
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "The request is not valid." },
    });
  });

  it("treats the arbiter as an outsider, as the project routes do", async () => {
    const client = await signIn();
    const arbiter = await signIn();
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: client.cookie,
      payload: {
        title: "FIXTURE",
        description: "FIXTURE",
        freelancerWallet: walletOnly(),
        arbiterWallet: arbiter.address,
        milestones: [{ title: "FIXTURE", amount: "1", deadline: "2099-01-01T00:00:00.000Z", criteria: ["x"] }],
      },
    });
    expect((await get(arbiter, `/projects/${res.json().id}/prooftrack`)).statusCode).toBe(404);
  });
});

describe("GET /projects/:id/prooftrack", () => {
  it("returns an empty timeline for a project with no events", async () => {
    const { client, project, url } = await setup();
    const res = await get(client, url);
    expect(res.json()).toEqual({ projectId: project.id, events: [] });
  });

  it("returns events in order, PENDING, with no explorer URL", async () => {
    const { client, freelancer, project, url } = await setup();
    const inference = await recordInference(project.id);
    const funded = await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    const { events } = (await get(client, url)).json();
    expect(events.map((e: { id: string }) => e.id)).toEqual([funded.id, inference.id]);
    expect(events[0]).toMatchObject({
      type: "MILESTONE_FUNDED",
      ecosystem: "ARC",
      network: "Arc Testnet",
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      reference: funded.referenceValue,
      status: "PENDING",
      statusReason: null,
      lastCheckedAt: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
      explorerUrl: null,
    });
  });

  it("contains no expected internals, file paths or stack traces", async () => {
    const { client, freelancer, project, url } = await setup();
    await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    const body = (await get(client, url)).body;
    for (const forbidden of [
      "expected",
      "expectedJson",
      AGREEMENT,
      "50000000",
      "privateFilePath",
      "publicProjectId",
      "milestoneId",
      "stack",
      "\\\\",
      "/srv",
      ".ts:",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("shows only this project's events", async () => {
    const first = await setup();
    const second = await setup();
    await recordFunded(first.project.id, first.freelancer.address, first.project.milestones[0].onchainMilestoneId);
    expect((await get(second.client, second.url)).json().events).toEqual([]);
  });
});

describe("no way to create an event", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)("%s on the events collection returns 404", async (method) => {
    const { client, url } = await setup();
    const res = await app.inject({ method, url: `${url}/events`, cookies: client.cookie, payload: { eventType: "MILESTONE_FUNDED" } });
    expect(res.statusCode, res.body).toBe(404);
    expect((await get(client, url)).json().events).toEqual([]);
  });

  it("POST on the timeline itself creates nothing", async () => {
    const { client, url } = await setup();
    const res = await app.inject({ method: "POST", url, cookies: client.cookie, payload: { eventType: "MILESTONE_FUNDED" } });
    expect(res.statusCode).toBe(404);
    expect((await get(client, url)).json().events).toEqual([]);
  });

  it("a verify route ignores a status in the body", async () => {
    const { client, freelancer, project, url } = await setup();
    await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    const res = await app.inject({
      method: "POST",
      url: `${url}/verify`,
      cookies: client.cookie,
      payload: { status: "VERIFIED", outcome: "MATCH" },
    });
    expect(res.json().events[0].status).toBe("PENDING");
  });

  it("no production source imports a MOCK, or records an event from a route", () => {
    const sources = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .map((path) => readFileSync(join(srcDir, path), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toContain("MOCK_");
      expect(source).not.toContain("recordEvent");
    }
  });
});

describe("rate limit", () => {
  it("the second run within 10 seconds returns 429, and works again after", async () => {
    const { client, url } = await setup();
    expect((await post(client, `${url}/verify`)).statusCode).toBe(200);
    current = new Date(current.getTime() + 9_999);
    const limited = await post(client, `${url}/verify`);
    expect(limited.statusCode, limited.body).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(limited.json().error.message).toMatch(/10 seconds/);
    current = new Date(current.getTime() + 1);
    expect((await post(client, `${url}/verify`)).statusCode).toBe(200);
  });

  it("the limit is per project, whoever calls", async () => {
    const first = await setup();
    const second = await setup();
    expect((await post(first.client, `${first.url}/verify`)).statusCode).toBe(200);
    expect((await post(first.freelancer, `${first.url}/verify`)).statusCode).toBe(429);
    expect((await post(second.client, `${second.url}/verify`)).statusCode).toBe(200);
  });

  it("the two verify routes share one limit, in both orders", async () => {
    const { client, freelancer, project, url } = await setup();
    const event = await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    const one = `${url}/events/${event.id}/verify`;
    expect((await post(client, `${url}/verify`)).statusCode).toBe(200);
    expect((await post(client, one)).statusCode).toBe(429);
    current = new Date(current.getTime() + 10_000);
    expect((await post(client, one)).statusCode).toBe(200);
    expect((await post(client, `${url}/verify`)).statusCode).toBe(429);
  });

  it("an outsider and a wrong event cannot use up the limit", async () => {
    const { client, url } = await setup();
    await post(await signIn(), `${url}/verify`);
    await post(client, `${url}/events/does-not-exist/verify`);
    expect((await post(client, `${url}/verify`)).statusCode).toBe(200);
  });
});

describe("POST /projects/:id/prooftrack/events/:eventId/verify", () => {
  it("an event from another project returns 404 and is not checked", async () => {
    const first = await setup();
    const second = await setup();
    const event = await recordFunded(first.project.id, first.freelancer.address, first.project.milestones[0].onchainMilestoneId);
    const res = await post(second.client, `${second.url}/events/${event.id}/verify`);
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    const stored = await prisma.proofEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.lastCheckedAt).toBeNull();
  });

  it("an unknown event ID returns 404, and an oversized one is refused, never a 500", async () => {
    const { client, url } = await setup();
    expect((await post(client, `${url}/events/missing/verify`)).statusCode).toBe(404);
    expect((await post(client, `${url}/events/${"x".repeat(100)}/verify`)).statusCode).toBe(404);
    // Fastify refuses a route parameter over 100 characters before any handler runs.
    expect((await post(client, `${url}/events/${"x".repeat(101)}/verify`)).statusCode).toBe(414);
  });
});

describe("with no chain adapter configured (production default)", () => {
  it("buildVerifiers registers nothing", () => {
    expect(buildVerifiers(null).size).toBe(0);
  });

  it("verify leaves events PENDING with a reason and updates lastCheckedAt", async () => {
    const { client, freelancer, project, url } = await setup();
    await recordFunded(project.id, freelancer.address, project.milestones[0].onchainMilestoneId);
    await recordInference(project.id);
    const { events } = (await post(client, `${url}/verify`)).json();
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.status).toBe("PENDING");
      expect(event.statusReason).toBe("No independent check available yet.");
      expect(event.lastCheckedAt).toBe(current.toISOString());
    }
  });
});

describe("with a MOCK chain adapter", () => {
  const adapterConfig = {
    chainId: 5042002,
    rpcUrl: "https://FIXTURE.invalid",
    escrowAddress: FIXTURE_ESCROW,
    tokenAddress: FIXTURE_TOKEN,
    explorerBase: "https://FIXTURE.invalid",
  };

  const scenario = async (chainOver: Partial<VerifiedChainEvent> = {}, fail?: Error) => {
    let chainEvent: VerifiedChainEvent | undefined;
    const adapter = new MOCK_ChainAdapter({
      config: adapterConfig,
      get chainEvent() {
        return chainEvent;
      },
      ...(fail ? { fail } : {}),
    } as ConstructorParameters<typeof MOCK_ChainAdapter>[0]);
    const mocked = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, now, chainAdapter: adapter });
    await mocked.ready();
    const { client, freelancer, project, url } = await setup(mocked);
    const onchainMilestoneId = project.milestones[0].onchainMilestoneId;
    const event = await recordFunded(project.id, freelancer.address, onchainMilestoneId);
    chainEvent = {
      txHash: event.referenceValue,
      chainId: 5042002,
      contractAddress: FIXTURE_ESCROW,
      milestoneId: onchainMilestoneId,
      amount: "50000000",
      token: FIXTURE_TOKEN,
      freelancer: freelancer.address,
      agreementHash: AGREEMENT,
      blockNumber: 1,
      verified: true,
      ...chainOver,
    };
    const res = await mocked.inject({ method: "POST", url: `${url}/verify`, cookies: client.cookie });
    await mocked.close();
    expect(res.statusCode, res.body).toBe(200);
    return { res, event, project };
  };

  it("a chain match becomes VERIFIED and is stored", async () => {
    const { res, event } = await scenario();
    expect(res.json().events[0]).toMatchObject({ status: "VERIFIED", statusReason: null });
    const row = await prisma.proofEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.verificationStatus).toBe("VERIFIED");
    expect(row.verifiedAt).not.toBeNull();
  });

  it("a chain mismatch becomes FAILED with a reason", async () => {
    const { res } = await scenario({ amount: "1" });
    expect(res.json().events[0]).toMatchObject({ status: "FAILED", statusReason: "The amount does not match." });
  });

  it("an adapter outage stays PENDING and exposes no internals", async () => {
    const { res } = await scenario({}, new Error("connect ECONNREFUSED internal-host:8545"));
    expect(res.json().events[0]).toMatchObject({ status: "PENDING", statusReason: "The check could not be completed." });
    expect(res.body).not.toContain("internal-host");
    expect(res.body).not.toContain("ECONNREFUSED");
  });

  it("a 0G event stays PENDING even with a chain adapter", async () => {
    const adapter = new MOCK_ChainAdapter({ config: adapterConfig });
    const mocked = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, now, chainAdapter: adapter });
    await mocked.ready();
    const { client, project, url } = await setup(mocked);
    await recordInference(project.id);
    const res = await mocked.inject({ method: "POST", url: `${url}/verify`, cookies: client.cookie });
    await mocked.close();
    expect(res.json().events[0]).toMatchObject({
      status: "PENDING",
      statusReason: "No independent check available yet.",
      referenceType: "INFERENCE_REQUEST_ID",
    });
    expect(adapter.calls).toEqual([]);
  });
});

describe("the Prisma store", () => {
  it("re-recording against the database returns the same event", async () => {
    const { freelancer, project } = await setup();
    const milestone = project.milestones[0].onchainMilestoneId;
    const tx = nextTx();
    const first = await recordFunded(project.id, freelancer.address, milestone, tx);
    const again = await recordFunded(project.id, freelancer.address, milestone, tx.toUpperCase().replace("0X", "0x"));
    expect(again.id).toBe(first.id);
    expect(await prisma.proofEvent.count({ where: { publicProjectId: project.id } })).toBe(1);
  });

  it("parallel records against the database make one event, with no error", async () => {
    const { freelancer, project } = await setup();
    const milestone = project.milestones[0].onchainMilestoneId;
    const tx = nextTx();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => recordFunded(project.id, freelancer.address, milestone, tx)),
    );
    expect(new Set(results.map((e) => e.id)).size).toBe(1);
  });

  it("refuses a reference recorded for another project", async () => {
    const first = await setup();
    const second = await setup();
    const tx = nextTx();
    await recordFunded(first.project.id, first.freelancer.address, first.project.milestones[0].onchainMilestoneId, tx);
    await expect(
      recordFunded(second.project.id, second.freelancer.address, second.project.milestones[0].onchainMilestoneId, tx),
    ).rejects.toThrow(/different project/);
  });

  it("round-trips expected, times and nulls exactly", async () => {
    const { freelancer, project } = await setup();
    const milestone = project.milestones[0].onchainMilestoneId;
    const event = await recordFunded(project.id, freelancer.address, milestone);
    const row = await createPrismaEventStore(prisma).getById(event.id);
    expect(row).toEqual(event);
    expect(row!.expected.amountBaseUnits).toBe("50000000");
    expect(row!.lastCheckedAt).toBeNull();
    expect(row!.statusReason).toBeNull();
  });
});

describe("AgreementVersion triggers", () => {
  it("all four still exist after every migration", async () => {
    const rows = await prisma.$queryRawUnsafe<{ name: string; tbl_name: string }[]>(
      "select name, tbl_name from sqlite_master where type = 'trigger' order by name",
    );
    expect(rows).toEqual([
      { name: "AgreementVersion_client_acceptance_final", tbl_name: "AgreementVersion" },
      { name: "AgreementVersion_freelancer_acceptance_final", tbl_name: "AgreementVersion" },
      { name: "AgreementVersion_no_delete", tbl_name: "AgreementVersion" },
      { name: "AgreementVersion_terms_immutable", tbl_name: "AgreementVersion" },
    ]);
  });

  it("the ProofTrack migration does not touch AgreementVersion", () => {
    const migrations = join(apiDir, "prisma", "migrations");
    const dir = readdirSync(migrations).find((name) => name.endsWith("_prooftrack_event_fields"));
    expect(dir).toBeDefined();
    expect(readFileSync(join(migrations, dir!, "migration.sql"), "utf8")).not.toContain("AgreementVersion");
  });
});
