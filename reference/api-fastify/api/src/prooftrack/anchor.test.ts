import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createArkivAnchorAdapter, MOCK_AnchorAdapter } from "@trustora/arkiv";
import { createProofTrack, type StoredEvent, verifierKey } from "@trustora/prooftrack";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";
import { createPrismaEventStore } from "./store.js";

// Runs the real migrations against a temporary database, never dev.db.
// Arkiv is MOCK_AnchorAdapter, so nothing here uses the network.
const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-anchor-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const config: AuthConfig = { domain: "trustora.test", sessionSecret: "test-only-secret-".repeat(3), isProduction: false };

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let current: Date;
const now = () => current;
const apps: ReturnType<typeof BuildApp>[] = [];

let counter = 0;
const nextTx = () => `0x${(counter += 1).toString(16).padStart(64, "b")}`;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", { cwd: apiDir, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
  ({ prisma } = await import("../db.js"));
  ({ buildApp } = await import("../app.js"));
}, 60_000);

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await prisma?.$disconnect();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

beforeEach(() => {
  current = new Date("2026-06-01T00:00:00.000Z");
});

const makeApp = async (over: Parameters<typeof BuildApp>[0] = {}) => {
  const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, now, ...over });
  apps.push(app);
  await app.ready();
  return app;
};

type App = Pick<ReturnType<typeof BuildApp>, "inject">;

const signIn = async (app: App) => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const nonce = await app.inject({ method: "POST", url: "/auth/nonce", payload: { address: wallet.address } });
  const { message } = nonce.json();
  const res = await app.inject({
    method: "POST",
    url: "/auth/verify-wallet",
    payload: { message, signature: await wallet.signMessage({ message }) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return {
    address: wallet.address.toLowerCase(),
    cookies: { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
  };
};

const tracker = () => createProofTrack({ store: createPrismaEventStore(prisma), now });

const MATCH_ALL = new Map([
  [
    verifierKey({ ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" }),
    async () => ({ outcome: "MATCH" as const, checkedAt: current }),
  ],
]);

const recordSource = (publicProjectId: string, eventType = "MILESTONE_FUNDED") =>
  tracker().recordEvent({
    publicProjectId,
    occurredAt: "2026-01-01T00:00:00.000Z",
    ecosystem: "ARC",
    network: "Arc Testnet",
    chainId: 5042002,
    eventType,
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: nextTx(),
    expected: { amountBaseUnits: "50000000", agreementHash: "c".repeat(64) },
  });

const verifiedSource = async (publicProjectId: string, eventType?: string) => {
  const event = await recordSource(publicProjectId, eventType);
  return tracker().verifyEvent(event.id, MATCH_ALL);
};

const setup = async (app: App) => {
  const client = await signIn(app);
  const freelancer = await signIn(app);
  const res = await app.inject({
    method: "POST",
    url: "/projects",
    cookies: client.cookies,
    payload: {
      title: "SECRET_TITLE",
      description: "SECRET_DESCRIPTION",
      freelancerWallet: freelancer.address,
      arbiterWallet: privateKeyToAccount(generatePrivateKey()).address,
      milestones: [{ title: "SECRET_MILESTONE", amount: "50000000", deadline: "2099-01-01T00:00:00.000Z", criteria: ["SECRET_CRITERION"] }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  return { client, freelancer, id, url: `/projects/${id}/prooftrack` };
};

const mockSetup = async () => {
  const adapter = new MOCK_AnchorAdapter();
  const app = await makeApp({ anchorAdapter: adapter });
  return { adapter, app, ...(await setup(app)) };
};

const anchor = (app: App, url: string, event: { id: string }, cookies?: Record<string, string>) =>
  app.inject({ method: "POST", url: `${url}/events/${event.id}/anchor`, ...(cookies ? { cookies } : {}) });

const after10s = () => {
  current = new Date(current.getTime() + 10_000);
};

const rowsFor = (id: string) => prisma.proofEvent.findMany({ where: { publicProjectId: id } });

describe("access", () => {
  it("returns 401 without a session, even for malformed JSON", async () => {
    const app = await makeApp({ anchorAdapter: new MOCK_AnchorAdapter() });
    const url = "/projects/TRU-PROJ-2026-0000000/prooftrack/events/x/anchor";
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
    const malformed = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(malformed.statusCode).toBe(401);
  });

  it("gives an outsider a 404 identical to a missing project, and publishes nothing", async () => {
    const { adapter, app, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    const outsider = await signIn(app);
    const hidden = await anchor(app, url, source, outsider.cookies);
    const missing = await anchor(app, "/projects/TRU-PROJ-2026-0000000/prooftrack", source, outsider.cookies);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).toBe(missing.body);
    expect(adapter.published).toHaveLength(0);
  });

  it("allows the freelancer as well as the client", async () => {
    const { app, freelancer, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    expect((await anchor(app, url, source, freelancer.cookies)).statusCode).toBe(201);
  });
});

describe("source event rules", () => {
  it.each(["PENDING", "FAILED", "BLOCKED", "UNAVAILABLE"])("rejects a %s source: never anchors an unverified claim", async (status) => {
    const { adapter, app, client, id, url } = await mockSetup();
    const source = await recordSource(id);
    await prisma.proofEvent.update({ where: { id: source.id }, data: { verificationStatus: status } });
    const res = await anchor(app, url, source, client.cookies);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error.code).toBe("SOURCE_NOT_VERIFIED");
    expect(adapter.published).toHaveLength(0);
    expect(await rowsFor(id)).toHaveLength(1);
  });

  it("rejects a ZERO_G source even when marked VERIFIED: no independent check exists", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    const event = await tracker().recordEvent({
      publicProjectId: id,
      occurredAt: "2026-01-01T00:00:00.000Z",
      ecosystem: "ZERO_G",
      network: "FIXTURE_NETWORK",
      eventType: "EVALUATION_COMPLETED",
      referenceType: "INFERENCE_REQUEST_ID",
      referenceValue: `FIXTURE_request_${nextTx().slice(-10)}`,
    });
    await prisma.proofEvent.update({ where: { id: event.id }, data: { verificationStatus: "VERIFIED" } });
    const res = await anchor(app, url, event, client.cookies);
    expect(res.statusCode).toBe(409);
    expect(adapter.published).toHaveLength(0);
  });

  it("rejects anchoring an anchor", async () => {
    const { app, client, id, url } = await mockSetup();
    const created = (await anchor(app, url, await verifiedSource(id), client.cookies)).json();
    after10s();
    const res = await anchor(app, url, created.anchor, client.cookies);
    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for an unknown event, and for another project's event", async () => {
    const { app, client, url } = await mockSetup();
    const other = await setup(app);
    const foreign = await verifiedSource(other.id);
    expect((await anchor(app, url, { id: "missing" }, client.cookies)).statusCode).toBe(404);
    const res = await anchor(app, url, foreign, client.cookies);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("This event was not found.");
  });
});

describe("happy path", () => {
  it("publishes, records EVIDENCE_ANCHORED, and the verifier makes it VERIFIED", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    const res = await anchor(app, url, source, client.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ projectId: id, sourceEventId: source.id, alreadyAnchored: false });
    expect(body.anchor).toMatchObject({
      type: "EVIDENCE_ANCHORED",
      ecosystem: "ARKIV",
      network: adapter.network,
      referenceType: "STORAGE_REFERENCE",
      status: "VERIFIED",
      statusReason: null,
      lastCheckedAt: current.toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
      note: "Public hash-only record on the Arkiv testnet. It expires.",
      explorerUrl: null,
    });
    expect(body.anchor.reference).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("stores which source event it anchors", async () => {
    const { app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    const { anchor: item } = (await anchor(app, url, source, client.cookies)).json();
    const stored = (await createPrismaEventStore(prisma).getById(item.id)) as StoredEvent;
    expect(stored.expected.sourceEventId).toBe(source.id);
  });

  it("writes only hashes and public identifiers to Arkiv (R1)", async () => {
    const { adapter, app, client, id, url, freelancer } = await mockSetup();
    await anchor(app, url, await verifiedSource(id), client.cookies);
    const [payload] = adapter.published;
    const { subjectDigest, ...rest } = payload!;
    expect(Object.keys(rest).sort()).toEqual(["eventDigest", "eventType", "network", "occurredAt", "projectId", "reference"]);
    expect(subjectDigest).toBe("c".repeat(64));
    const text = JSON.stringify(payload);
    for (const forbidden of ["SECRET_", client.address, freelancer.address, "50000000"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("the timeline shows the anchor's extras on anchors only, and never expected", async () => {
    const { app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    await anchor(app, url, source, client.cookies);
    const res = await app.inject({ method: "GET", url, cookies: client.cookies });
    const { events } = res.json();
    const anchored = events.find((e: { type: string }) => e.type === "EVIDENCE_ANCHORED");
    const plain = events.find((e: { type: string }) => e.type === "MILESTONE_FUNDED");
    expect(anchored.note).toMatch(/It expires/);
    expect(plain).not.toHaveProperty("note");
    expect(plain).not.toHaveProperty("expiresAt");
    for (const forbidden of ["sourceEventId", "expectedJson", "anchorExpiresAt", "c".repeat(64)]) {
      expect(res.body).not.toContain(forbidden);
    }
  });

  it("no response describes the anchor as lasting forever (R3)", async () => {
    const { app, client, id, url } = await mockSetup();
    const res = await anchor(app, url, await verifiedSource(id), client.cookies);
    expect(res.body).not.toMatch(/permanent|immutable|forever/i);
  });
});

describe("idempotent per source event", () => {
  it("a later call returns the existing anchor, publishing and recording nothing new", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    const first = (await anchor(app, url, source, client.cookies)).json();
    after10s();
    const again = await anchor(app, url, source, client.cookies);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ alreadyAnchored: true, sourceEventId: source.id });
    expect(again.json().anchor.id).toBe(first.anchor.id);
    expect(adapter.published).toHaveLength(1);
    expect(await rowsFor(id)).toHaveLength(2);
  });

  it("two different sources get two anchors", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    await anchor(app, url, await verifiedSource(id), client.cookies);
    after10s();
    const res = await anchor(app, url, await verifiedSource(id, "PAYMENT_RELEASED"), client.cookies);
    expect(res.statusCode).toBe(201);
    expect(adapter.published).toHaveLength(2);
  });
});

describe("rate limit", () => {
  it("a rapid repeat returns 429, and it works again after 10 seconds", async () => {
    const { app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    expect((await anchor(app, url, source, client.cookies)).statusCode).toBe(201);
    current = new Date(current.getTime() + 9_999);
    const limited = await anchor(app, url, source, client.cookies);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    current = new Date(current.getTime() + 1);
    expect((await anchor(app, url, source, client.cookies)).statusCode).toBe(200);
  });

  it("is per project and whoever calls, across different source events", async () => {
    const { app, client, freelancer, id, url } = await mockSetup();
    await anchor(app, url, await verifiedSource(id), client.cookies);
    const other = await verifiedSource(id, "PAYMENT_RELEASED");
    expect((await anchor(app, url, other, freelancer.cookies)).statusCode).toBe(429);
    const second = await setup(app);
    expect((await anchor(app, second.url, await verifiedSource(second.id), second.client.cookies)).statusCode).toBe(201);
  });

  it("outsiders and rejected sources cannot use it up", async () => {
    const { app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    await anchor(app, url, source, (await signIn(app)).cookies);
    await anchor(app, url, await recordSource(id, "PAYMENT_RELEASED"), client.cookies);
    await anchor(app, url, { id: "missing" }, client.cookies);
    expect((await anchor(app, url, source, client.cookies)).statusCode).toBe(201);
  });
});

describe("disabled (R8)", () => {
  it("returns 501 ARKIV_NOT_ENABLED for a participant, and 404 for an outsider", async () => {
    const app = await makeApp({ anchorAdapter: null });
    const { client, id, url } = await setup(app);
    const source = await verifiedSource(id);
    const res = await anchor(app, url, source, client.cookies);
    expect(res.statusCode, res.body).toBe(501);
    expect(res.json().error.code).toBe("ARKIV_NOT_ENABLED");
    expect((await anchor(app, url, source, (await signIn(app)).cookies)).statusCode).toBe(404);
    expect(await rowsFor(id)).toHaveLength(1);
  });

  it("with no ARKIV_* set, the default wiring is off", async () => {
    const app = await makeApp();
    const { client, id, url } = await setup(app);
    expect((await anchor(app, url, await verifiedSource(id), client.cookies)).statusCode).toBe(501);
  });

  it("enabled but not configured stays off, and logs a reason code with no key", async () => {
    const privateKey = `0x${"7".repeat(62)}`;
    process.env.ARKIV_ENABLED = "true";
    process.env.ARKIV_ACCESS_KEY = "FIXTURE_ACCESS_VALUE";
    process.env.ARKIV_PRIVATE_KEY = privateKey; // secret-scan:allow
    try {
      const lines: string[] = [];
      const stream = new Writable({ write(chunk, _e, done) { lines.push(String(chunk)); done(); } });
      const app = await makeApp({ logger: { stream } });
      const { client, id, url } = await setup(app);
      expect((await anchor(app, url, await verifiedSource(id), client.cookies)).statusCode).toBe(501);
      const output = lines.join("");
      expect(output).toContain("INVALID_PRIVATE_KEY");
      expect(output).not.toContain(privateKey);
      expect(output).not.toContain("FIXTURE_ACCESS_VALUE");
    } finally {
      delete process.env.ARKIV_ENABLED;
      delete process.env.ARKIV_ACCESS_KEY;
      delete process.env.ARKIV_PRIVATE_KEY;
    }
  });

  it("an anchor event with Arkiv turned off stays PENDING on re-check", async () => {
    const enabled = await mockSetup();
    await anchor(enabled.app, enabled.url, await verifiedSource(enabled.id), enabled.client.cookies);
    const off = await makeApp({ anchorAdapter: null });
    const res = await off.inject({ method: "POST", url: `${enabled.url}/verify`, cookies: enabled.client.cookies });
    const anchored = res.json().events.find((e: { type: string }) => e.type === "EVIDENCE_ANCHORED");
    expect(anchored.status).toBe("PENDING");
  });
});

describe("publish failure", () => {
  it.each(["RATE_LIMITED", "TIMEOUT", "UNAUTHORIZED", "INSUFFICIENT_FUNDS", "UNAVAILABLE"] as const)(
    "%s: 503 ANCHOR_UNAVAILABLE, nothing recorded, nothing else changes",
    async (failure) => {
      const { adapter, app, client, id, url } = await mockSetup();
      const source = await verifiedSource(id);
      const before = await rowsFor(id);
      adapter.publishFailure = failure;
      const res = await anchor(app, url, source, client.cookies);
      expect(res.statusCode, res.body).toBe(503);
      expect(res.json().error.code).toBe("ANCHOR_UNAVAILABLE");
      expect(await rowsFor(id)).toEqual(before);
    },
  );

  it("can succeed later", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    const source = await verifiedSource(id);
    adapter.publishFailure = "UNAVAILABLE";
    await anchor(app, url, source, client.cookies);
    adapter.publishFailure = null;
    after10s();
    expect((await anchor(app, url, source, client.cookies)).statusCode).toBe(201);
  });

  it("SDK errors holding keys reach neither the response nor the logs (R7)", async () => {
    const accessKey = "FIXTURE_ACCESS_VALUE";
    const privateKey = `0x${"7".repeat(64)}` as const;
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _e, done) { lines.push(String(chunk)); done(); } });
    const leak = new Error(`request failed https://rpc.example.invalid/${accessKey} with ${privateKey}`);
    const adapter = createArkivAnchorAdapter({
      connection: { accessKey, privateKey, requestTimeoutMs: 100 },
      anchorAddress: `0x${"a".repeat(40)}`,
      entityDays: 30,
      connect: async () => {
        throw leak;
      },
    });
    const app = await makeApp({ anchorAdapter: adapter, logger: { level: "trace", stream } });
    const { client, id, url } = await setup(app);
    const res = await anchor(app, url, await verifiedSource(id), client.cookies);
    expect(res.statusCode).toBe(503);
    const output = lines.join("") + res.body;
    expect(output).not.toContain(accessKey);
    expect(output).not.toContain(privateKey);
    expect(output).toContain("anchor publish failed");
  });
});

describe("re-checking an anchor through the verify route", () => {
  const anchored = async () => {
    const context = await mockSetup();
    const source = await verifiedSource(context.id);
    const { anchor: item } = (await anchor(context.app, context.url, source, context.client.cookies)).json();
    const recheck = async () => {
      const res = await context.app.inject({ method: "POST", url: `${context.url}/verify`, cookies: context.client.cookies });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().events.find((e: { type: string }) => e.type === "EVIDENCE_ANCHORED");
    };
    return { ...context, item, recheck };
  };

  it("stays VERIFIED while the anchor still matches", async () => {
    const { recheck } = await anchored();
    expect((await recheck()).status).toBe("VERIFIED");
  });

  it.each<[string, (a: MOCK_AnchorAdapter, key: string) => void]>([
    ["expired", (a, key) => a.expire(key)],
    ["gone", (a, key) => a.remove(key)],
    ["rate limited", (a) => { a.readFailure = "RATE_LIMITED"; }],
    ["erroring", (a) => { a.readFailure = new Error("connect /srv/secret-host failed"); }],
  ])("%s: goes to PENDING with a plain reason, never VERIFIED or FAILED", async (_label, breakIt) => {
    const { adapter, item, recheck } = await anchored();
    breakIt(adapter, item.reference);
    const event = await recheck();
    expect(event.status).toBe("PENDING");
    expect(event.statusReason).toBe("Anchor expired or not readable right now.");
    expect(JSON.stringify(event)).not.toContain("secret-host");
  });

  it("wrong owner: FAILED", async () => {
    const { adapter, item, recheck } = await anchored();
    adapter.setOwner(item.reference, `0x${"9".repeat(40)}`);
    expect(await recheck()).toMatchObject({ status: "FAILED", statusReason: "The anchor was not written by our anchor address." });
  });

  it("wrong digest: FAILED", async () => {
    const { adapter, item, recheck } = await anchored();
    adapter.tamper(item.reference, { eventDigest: "0".repeat(64) });
    expect(await recheck()).toMatchObject({ status: "FAILED", statusReason: "The anchor's digest does not match our records." });
  });

  it("a failed read at publish time leaves the new anchor PENDING, not VERIFIED", async () => {
    const { adapter, app, client, id, url } = await mockSetup();
    adapter.readFailure = "TIMEOUT";
    const res = await anchor(app, url, await verifiedSource(id), client.cookies);
    expect(res.statusCode).toBe(201);
    expect(res.json().anchor).toMatchObject({ status: "PENDING", statusReason: "Anchor expired or not readable right now." });
  });
});

describe("Arkiv failure never affects other flows (R8, R9)", () => {
  it("with Arkiv failing, projects, timelines and checks of other events still work", async () => {
    const adapter = new MOCK_AnchorAdapter();
    adapter.publishFailure = "UNAVAILABLE";
    adapter.readFailure = "UNAVAILABLE";
    const app = await makeApp({ anchorAdapter: adapter });
    const { client, id, url } = await setup(app);
    const source = await recordSource(id);

    expect((await app.inject({ method: "GET", url: `/projects/${id}`, cookies: client.cookies })).statusCode).toBe(200);
    const accepted = await app.inject({ method: "POST", url: `/projects/${id}/agreement/accept`, cookies: client.cookies, payload: { version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const res = await app.inject({ method: "POST", url: `${url}/verify`, cookies: client.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().events.find((e: { id: string }) => e.id === source.id).status).toBe("PENDING");
  });

  it("the route code has nothing that could release or refund", () => {
    const code = readFileSync(join(apiDir, "src", "prooftrack", "anchorRoutes.ts"), "utf8");
    expect(code).not.toMatch(/\b(verifyRelease|release\(|refund\(|milestone\.update|project\.update)\b/);
  });
});
