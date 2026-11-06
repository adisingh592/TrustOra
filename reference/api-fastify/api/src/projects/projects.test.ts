import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, stringToBytes, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { AuthConfig } from "../auth/config.js";
import { SESSION_COOKIE } from "../auth/session.js";
import type { prisma as Prisma } from "../db.js";
import { canonicalJson, computeOnchainMilestoneId, hashAgreementTerms, sha256Hex } from "./agreement.js";

// Runs the real migrations against a temporary database, never dev.db.
// Wallets are throwaway viem keys generated per run, and the token is a labelled fake.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-projects-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const config: AuthConfig = {
  domain: "trustora.test",
  sessionSecret: "test-only-secret-".repeat(3),
  isProduction: false,
};
const DEADLINE = "2099-01-01T00:00:00.000Z";

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let app: ReturnType<typeof BuildApp>;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("../db.js"));
  ({ buildApp } = await import("../app.js"));
  app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

interface Actor {
  address: string;
  mixedCaseAddress: string;
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
    mixedCaseAddress: wallet.address,
    cookie: { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
  };
};

const walletOnly = () => privateKeyToAccount(generatePrivateKey()).address;

const post = (actor: Actor | null, url: string, payload?: object) =>
  app.inject({
    method: "POST",
    url,
    ...(payload ? { payload } : {}),
    ...(actor ? { cookies: actor.cookie } : {}),
  });

const get = (actor: Actor | null, url: string) =>
  app.inject({ method: "GET", url, ...(actor ? { cookies: actor.cookie } : {}) });

const milestoneInput = (over: object = {}) => ({
  title: "FIXTURE milestone",
  amount: "50000000",
  deadline: DEADLINE,
  criteria: ["FIXTURE criterion"],
  ...over,
});

const projectInput = (freelancerWallet: string, over: object = {}) => ({
  title: "FIXTURE project",
  description: "FIXTURE description",
  freelancerWallet,
  arbiterWallet: walletOnly(),
  milestones: [milestoneInput()],
  ...over,
});

const setup = async (over: object = {}) => {
  const client = await signIn();
  const freelancer = await signIn();
  const res = await post(client, "/projects", projectInput(freelancer.address, over));
  expect(res.statusCode, res.body).toBe(201);
  const project = res.json();
  return { client, freelancer, project, url: `/projects/${project.id}` };
};

interface ProjectMilestones {
  milestones: {
    id: string;
    title: string;
    amountBaseUnits: string;
    deadline: string;
    criteria: string[];
  }[];
}

const sameTerms = (project: ProjectMilestones, over: object = {}) => ({
  milestones: project.milestones.map((m) => ({
    id: m.id,
    title: m.title,
    amount: m.amountBaseUnits,
    deadline: m.deadline,
    criteria: m.criteria,
    ...over,
  })),
});

const errorCode = (res: { json: () => { error: { code: string } } }) => res.json().error.code;

describe("POST /projects", () => {
  it("creates a draft project with agreement version 1", async () => {
    const { client, freelancer, project } = await setup();
    expect(project.id).toMatch(/^TRU-PROJ-2026-\d{7}$/);
    expect(project.status).toBe("DRAFT");
    expect(project.paymentMode).toBe("ARC_ESCROW");
    expect(project.role).toBe("client");
    expect(project.clientWallet).toBe(client.address);
    expect(project.freelancerWallet).toBe(freelancer.address);
    expect(project.agreement.version).toBe(1);
    expect(project.agreement.agreementHash).toMatch(/^[0-9a-f]{64}$/);
    expect(project.agreement.clientAcceptedAt).toBeNull();
    expect(project.milestones[0]).toMatchObject({
      amountBaseUnits: "50000000",
      tokenAddress: FIXTURE_TOKEN,
      tokenDecimals: 6,
      deadline: DEADLINE,
      status: "DRAFT",
      criteria: ["FIXTURE criterion"],
    });
  });

  it("supports EXTERNAL_PAYMENT mode upon project creation", async () => {
    const { project } = await setup({ paymentMode: "EXTERNAL_PAYMENT" });
    expect(project.paymentMode).toBe("EXTERNAL_PAYMENT");
    expect(project.status).toBe("DRAFT");
  });

  it("writes one version row per milestone, all with the same hash", async () => {
    const { project } = await setup({
      milestones: [milestoneInput(), milestoneInput({ title: "second" })],
    });
    const rows = await prisma.agreementVersion.findMany({
      where: { milestone: { project: { publicProjectId: project.id } } },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.agreementHash)).size).toBe(1);
    expect(rows.every((r) => r.version === 1)).toBe(true);
  });

  it("stores mixed-case wallets lowercase", async () => {
    const client = await signIn();
    const freelancer = await signIn();
    const arbiter = walletOnly();
    const res = await post(
      client,
      "/projects",
      projectInput(freelancer.mixedCaseAddress, { arbiterWallet: arbiter }),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().freelancerWallet).toBe(freelancer.address);
    expect(res.json().arbiterWallet).toBe(arbiter.toLowerCase());
    expect(await prisma.user.count({ where: { walletAddress: arbiter.toLowerCase() } })).toBe(1);
    expect(await prisma.user.count({ where: { walletAddress: arbiter } })).toBe(0);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["negative five", "-5"],
    ["decimal", "1.5"],
    ["leading zeros", "007"],
    ["leading zero fifty", "050"],
    ["non-numeric", "abc"],
    ["empty string", ""],
    ["30+ digits", "9".repeat(31)],
    ["above the maximum", "1000000000000001"],
    ["a number", 50000000],
    ["scientific notation", "1e6"],
  ])("rejects a bad amount: %s", async (_label, amount) => {
    const client = await signIn();
    const res = await post(
      client,
      "/projects",
      projectInput(walletOnly(), { milestones: [milestoneInput({ amount })] }),
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(errorCode(res)).toBe("INVALID_INPUT");
  });

  it("rejects the same wallet as client and freelancer, in any case", async () => {
    const client = await signIn();
    for (const wallet of [client.address, client.mixedCaseAddress]) {
      const res = await post(client, "/projects", projectInput(wallet));
      expect(res.statusCode, res.body).toBe(400);
      expect(errorCode(res)).toBe("SAME_WALLET");
    }
  });

  it("rejects an arbiter who is also the client or the freelancer", async () => {
    const client = await signIn();
    const freelancer = walletOnly();
    for (const arbiterWallet of [client.address, freelancer]) {
      const res = await post(client, "/projects", projectInput(freelancer, { arbiterWallet }));
      expect(res.statusCode, res.body).toBe(400);
      expect(errorCode(res)).toBe("SAME_WALLET");
    }
  });

  it("creates no user when the request is refused", async () => {
    const client = await signIn();
    const freelancer = walletOnly();
    const res = await post(
      client,
      "/projects",
      projectInput(freelancer, { arbiterWallet: client.address }),
    );
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { walletAddress: freelancer.toLowerCase() } })).toBe(0);
  });

  it.each([
    ["bad freelancer wallet", { freelancerWallet: "0x1234" }],
    ["bad arbiter wallet", { arbiterWallet: "nope" }],
    ["no milestones", { milestones: [] }],
    ["too many milestones", { milestones: Array.from({ length: 11 }, (_, i) => milestoneInput({ title: `m${i}` })) }],
    ["past deadline", { milestones: [milestoneInput({ deadline: "2020-01-01T00:00:00.000Z" })] }],
    ["no criteria", { milestones: [milestoneInput({ criteria: [] })] }],
    ["too many criteria", { milestones: [milestoneInput({ criteria: Array.from({ length: 11 }, (_, i) => `c${i}`) })] }],
    ["criteria item too long", { milestones: [milestoneInput({ criteria: ["x".repeat(501)] })] }],
    ["title too long", { title: "x".repeat(121) }],
    ["description too long", { description: "x".repeat(2001) }],
  ])("rejects %s", async (_label, over) => {
    const client = await signIn();
    const res = await post(client, "/projects", projectInput(walletOnly(), over));
    expect(res.statusCode, res.body).toBe(400);
    expect(errorCode(res)).toBe("INVALID_INPUT");
  });

  it.each([
    ["agreementHash", { agreementHash: "a".repeat(64) }],
    ["status", { status: "AGREED" }],
    ["clientId", { clientId: "someone" }],
  ])("never accepts a client-supplied %s", async (_label, over) => {
    const client = await signIn();
    const res = await post(client, "/projects", projectInput(walletOnly(), over));
    expect(res.statusCode, res.body).toBe(400);
  });

  it("never accepts a client-supplied onchainMilestoneId", async () => {
    const client = await signIn();
    const milestones = [milestoneInput({ onchainMilestoneId: `0x${"a".repeat(64)}` })];
    const res = await post(client, "/projects", projectInput(walletOnly(), { milestones }));
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses with 503 rather than guessing when the token is not configured", async () => {
    const unconfigured = buildApp({ config, logger: false, tokenAddress: null });
    const client = await signIn();
    const res = await unconfigured.inject({
      method: "POST",
      url: "/projects",
      payload: projectInput(walletOnly()),
      cookies: client.cookie,
    });
    expect(res.statusCode, res.body).toBe(503);
    expect(errorCode(res)).toBe("TOKEN_NOT_CONFIGURED");
    await unconfigured.close();
  });
});

describe("onchainMilestoneId", () => {
  it("is keccak256 of the UTF-8 bytes of the internal milestone id, as 0x + 64 hex", async () => {
    const { project } = await setup();
    const { id, onchainMilestoneId } = project.milestones[0];
    expect(onchainMilestoneId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(onchainMilestoneId).toBe(keccak256(stringToBytes(id)));
    const row = await prisma.milestone.findUniqueOrThrow({ where: { id } });
    expect(row.onchainMilestoneId).toBe(onchainMilestoneId);
  });

  it("hashes the UTF-8 bytes", () => {
    expect(computeOnchainMilestoneId("milestone")).toBe(
      keccak256(new TextEncoder().encode("milestone")),
    );
  });

  it("matches keccak256 with toBytes", () => {
    const id = "test-milestone-id";
    expect(computeOnchainMilestoneId(id)).toBe(keccak256(toBytes(id)));
  });

  it("stays the same across agreement versions", async () => {
    const { client, project, url } = await setup();
    const res = await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    expect(res.json().milestones[0].onchainMilestoneId).toBe(project.milestones[0].onchainMilestoneId);
  });
});

describe("access", () => {
  const routes: [string, "GET" | "POST", string, object?][] = [
    ["create", "POST", "/projects", {}],
    ["list", "GET", "/projects"],
    ["read", "GET", "/projects/TRU-PROJ-2026-0000000"],
    ["propose", "POST", "/projects/TRU-PROJ-2026-0000000/agreement/versions", {}],
    ["accept", "POST", "/projects/TRU-PROJ-2026-0000000/agreement/accept", { version: 1 }],
  ];

  it.each(routes)("returns 401 without a session: %s", async (_label, method, url, payload) => {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(401);
    expect(errorCode(res)).toBe("UNAUTHENTICATED");
  });

  it("returns 401, not 400, for bad JSON without a session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400, not 500, for bad JSON with a session", async () => {
    const client = await signIn();
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { "content-type": "application/json" },
      payload: "{not json",
      cookies: client.cookie,
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("INVALID_INPUT");
  });

  it("GET /projects lists only projects where I am client or freelancer", async () => {
    const { client, freelancer, project } = await setup();
    const outsider = await signIn();
    const ids = async (actor: Actor) =>
      (await get(actor, "/projects")).json().projects.map((p: { id: string }) => p.id);

    expect(await ids(client)).toEqual([project.id]);
    expect(await ids(freelancer)).toEqual([project.id]);
    expect(await ids(outsider)).toEqual([]);
    expect((await get(freelancer, "/projects")).json().projects[0].role).toBe("freelancer");
  });

  it("GET /projects/:id works for both participants", async () => {
    const { client, freelancer, url, project } = await setup();
    expect((await get(client, url)).json().id).toBe(project.id);
    expect((await get(freelancer, url)).json().role).toBe("freelancer");
  });

  it("returns 404, not 403, to an outsider on every project route", async () => {
    const { project, url } = await setup();
    const outsider = await signIn();
    const attempts = [
      await get(outsider, url),
      await post(outsider, `${url}/agreement/versions`, sameTerms(project)),
      await post(outsider, `${url}/agreement/accept`, { version: 1 }),
    ];
    for (const res of attempts) {
      expect(res.statusCode, res.body).toBe(404);
      expect(errorCode(res)).toBe("NOT_FOUND");
    }
  });

  it("gives an outsider the same response as a project that does not exist", async () => {
    const { url } = await setup();
    const outsider = await signIn();
    const hidden = await get(outsider, url);
    const missing = await get(outsider, "/projects/TRU-PROJ-2026-0000000");
    const malformed = await get(outsider, "/projects/not-an-id");
    expect(hidden.body).toBe(missing.body);
    expect(hidden.body).toBe(malformed.body);
  });

  it("treats the arbiter as an outsider", async () => {
    const client = await signIn();
    const arbiter = await signIn();
    const res = await post(
      client,
      "/projects",
      projectInput(walletOnly(), { arbiterWallet: arbiter.address }),
    );
    expect((await get(arbiter, `/projects/${res.json().id}`)).statusCode).toBe(404);
  });

  it("does not let an outsider's failed accept change anything", async () => {
    const { client, url } = await setup();
    const outsider = await signIn();
    await post(outsider, `${url}/agreement/accept`, { version: 1 });
    expect((await get(client, url)).json().agreement.clientAcceptedAt).toBeNull();
  });
});

describe("POST /projects/:id/agreement/accept", () => {
  it("rejects an accept attempt by the arbiter", async () => {
    const client = await signIn();
    const arbiter = await signIn();
    const res = await post(
      client,
      "/projects",
      projectInput(walletOnly(), { arbiterWallet: arbiter.address }),
    );
    const projectId = res.json().id;
    const acceptRes = await post(arbiter, `/projects/${projectId}/agreement/accept`, { version: 1 });
    expect(acceptRes.statusCode).toBe(404);
  });

  it("both accepting the latest version moves the project and milestones to AGREED", async () => {
    const { client, freelancer, url } = await setup();
    const first = await post(client, `${url}/agreement/accept`, { version: 1 });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().status).toBe("DRAFT");
    expect(first.json().agreement.clientAcceptedAt).not.toBeNull();
    expect(first.json().agreement.freelancerAcceptedAt).toBeNull();

    const second = await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().status).toBe("AGREED");
    expect(second.json().agreement.freelancerAcceptedAt).not.toBeNull();
    expect(second.json().milestones[0].status).toBe("AGREED");
  });

  it("one party accepting twice is not agreement", async () => {
    const { client, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const again = await post(client, `${url}/agreement/accept`, { version: 1 });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe("DRAFT");
    expect(again.json().agreement.freelancerAcceptedAt).toBeNull();
  });

  it("repeating an acceptance keeps the original time", async () => {
    const { client, url } = await setup();
    const first = (await post(client, `${url}/agreement/accept`, { version: 1 })).json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = (await post(client, `${url}/agreement/accept`, { version: 1 })).json();
    expect(again.agreement.clientAcceptedAt).toBe(first.agreement.clientAcceptedAt);
  });

  it.each([[2], [99]])("rejects a version that is not the latest: %i", async (version) => {
    const { client, url } = await setup();
    const res = await post(client, `${url}/agreement/accept`, { version });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe("VERSION_NOT_LATEST");
    expect((await get(client, url)).json().agreement.clientAcceptedAt).toBeNull();
  });

  it("rejects an older version once a newer one exists", async () => {
    const { client, freelancer, project, url } = await setup();
    await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    const res = await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe("VERSION_NOT_LATEST");
  });

  it.each([[{}], [{ version: "1" }], [{ version: 0 }], [{ version: 1.5 }]])(
    "rejects a malformed body: %j",
    async (body) => {
      const { client, url } = await setup();
      const res = await post(client, `${url}/agreement/accept`, body);
      expect(res.statusCode, res.body).toBe(400);
    },
  );

  it("a client cannot accept for the freelancer, and the body cannot choose a role", async () => {
    const { client, url } = await setup();
    const forged = await post(client, `${url}/agreement/accept`, { version: 1, role: "freelancer" });
    expect(forged.statusCode).toBe(400);

    const res = await post(client, `${url}/agreement/accept`, { version: 1 });
    expect(res.json().agreement.clientAcceptedAt).not.toBeNull();
    expect(res.json().agreement.freelancerAcceptedAt).toBeNull();
  });

  it("a freelancer's acceptance only records the freelancer's side", async () => {
    const { freelancer, url } = await setup();
    const res = await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    expect(res.json().agreement.freelancerAcceptedAt).not.toBeNull();
    expect(res.json().agreement.clientAcceptedAt).toBeNull();
  });

  it("records acceptance on every milestone's row", async () => {
    const { client, freelancer, project, url } = await setup({
      milestones: [milestoneInput(), milestoneInput({ title: "second" })],
    });
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const res = await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    expect(res.json().status).toBe("AGREED");
    const rows = await prisma.agreementVersion.findMany({
      where: { milestone: { project: { publicProjectId: project.id } } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.clientAcceptedAt && r.freelancerAcceptedAt)).toBe(true);
  });

  it("both accepting at the same moment still reaches AGREED, with no 500", async () => {
    const { client, freelancer, url } = await setup();
    const results = await Promise.all([
      post(client, `${url}/agreement/accept`, { version: 1 }),
      post(freelancer, `${url}/agreement/accept`, { version: 1 }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await get(client, url)).json().status).toBe("AGREED");
  });

  it("accepting while a new version is proposed never counts for the new version", async () => {
    const { client, freelancer, project, url } = await setup();
    const [, accepted] = await Promise.all([
      post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" })),
      post(freelancer, `${url}/agreement/accept`, { version: 1 }),
    ]);
    expect([200, 409]).toContain(accepted.statusCode);
    const state = (await get(client, url)).json();
    expect(state.agreement.version).toBe(2);
    expect(state.agreement.freelancerAcceptedAt).toBeNull();
    expect(state.status).toBe("DRAFT");
  });
});

describe("POST /projects/:id/agreement/versions", () => {
  it("creates version N+1 with no acceptances and keeps version N's", async () => {
    const { client, freelancer, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const res = await post(
      freelancer,
      `${url}/agreement/versions`,
      sameTerms(project, { amount: "75000000" }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const updated = res.json();
    expect(updated.agreement.version).toBe(2);
    expect(updated.agreement.clientAcceptedAt).toBeNull();
    expect(updated.agreement.freelancerAcceptedAt).toBeNull();
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0].clientAcceptedAt).not.toBeNull();
    expect(updated.milestones[0].amountBaseUnits).toBe("75000000");
  });

  it("a new version after agreement returns the project to DRAFT", async () => {
    const { client, freelancer, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    const res = await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    expect(res.json().status).toBe("DRAFT");
    expect(res.json().milestones[0].status).toBe("DRAFT");
  });

  it("both must accept the new version: an earlier acceptance does not carry over", async () => {
    const { client, freelancer, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    const res = await post(freelancer, `${url}/agreement/accept`, { version: 2 });
    expect(res.json().status).toBe("DRAFT");
    const done = await post(client, `${url}/agreement/accept`, { version: 2 });
    expect(done.json().status).toBe("AGREED");
  });

  it.each<[string, (m: object[]) => object[]]>([
    ["a missing milestone", (m) => m.slice(1)],
    ["a repeated milestone", (m) => [m[0]!, m[0]!]],
    ["an unknown milestone", (m) => [m[0]!, { ...m[1]!, id: "someone-elses" }]],
  ])("rejects %s", async (_label, change) => {
    const { client, project, url } = await setup({
      milestones: [milestoneInput(), milestoneInput({ title: "second" })],
    });
    const res = await post(client, `${url}/agreement/versions`, {
      milestones: change(sameTerms(project).milestones),
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(errorCode(res)).toBe("MILESTONES_MISMATCH");
    expect((await get(client, url)).json().agreement.version).toBe(1);
  });

  it("rejects a bad amount and a client-supplied hash", async () => {
    const { client, project, url } = await setup();
    const bad = await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "0" }));
    expect(bad.statusCode).toBe(400);
    const forged = await post(client, `${url}/agreement/versions`, {
      ...sameTerms(project),
      agreementHash: "a".repeat(64),
    });
    expect(forged.statusCode).toBe(400);
  });

  it("refuses once money could have moved", async () => {
    const { client, project, url } = await setup();
    await prisma.project.update({
      where: { publicProjectId: project.id },
      data: { status: "FUNDED" },
    });
    const res = await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe("NOT_NEGOTIABLE");
    const accept = await post(client, `${url}/agreement/accept`, { version: 1 });
    expect(accept.statusCode).toBe(409);
  });

  it("many parallel proposals all succeed with different version numbers", async () => {
    const { client, freelancer, project, url } = await setup();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        post(
          index % 2 ? client : freelancer,
          `${url}/agreement/versions`,
          sameTerms(project, { amount: String(index + 1) }),
        ),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(12).fill(201));
    const state = (await get(client, url)).json();
    expect(state.versions.map((v: { version: number }) => v.version)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
  });
});

describe("SEC-002: accepted terms cannot change", () => {
  const firstRow = (publicProjectId: string, version = 1) =>
    prisma.agreementVersion.findFirstOrThrow({
      where: { version, milestone: { project: { publicProjectId } } },
    });

  it("a new version leaves the accepted version's terms and hash untouched", async () => {
    const { client, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const before = await firstRow(project.id);
    await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    const after = await firstRow(project.id);
    expect(after).toEqual(before);
    expect(sha256Hex(after.criteriaJson)).toBe(after.agreementHash);
  });

  it.each([
    ["criteriaJson", { criteriaJson: "[]" }],
    ["agreementHash", { agreementHash: "changed" }],
    ["version", { version: 99 }],
  ])("the database refuses to change %s, even outside the API", async (_label, data) => {
    const { client, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const row = await firstRow(project.id);
    await expect(prisma.agreementVersion.update({ where: { id: row.id }, data })).rejects.toThrow();
    expect(await firstRow(project.id)).toEqual(row);
  });

  it("the database also refuses to change terms before anyone has accepted", async () => {
    const { project } = await setup();
    const row = await firstRow(project.id);
    await expect(
      prisma.agreementVersion.update({ where: { id: row.id }, data: { agreementHash: "changed" } }),
    ).rejects.toThrow();
    expect(await firstRow(project.id)).toEqual(row);
  });

  it("the database refuses to delete a version", async () => {
    const { project } = await setup();
    const row = await firstRow(project.id);
    await expect(prisma.agreementVersion.delete({ where: { id: row.id } })).rejects.toThrow();
    expect(await firstRow(project.id)).toEqual(row);
  });

  it("the database refuses to change or clear an acceptance", async () => {
    const { client, freelancer, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    await post(freelancer, `${url}/agreement/accept`, { version: 1 });
    const row = await firstRow(project.id);
    for (const value of [null, new Date("2030-01-01T00:00:00.000Z")]) {
      for (const data of [{ clientAcceptedAt: value }, { freelancerAcceptedAt: value }]) {
        await expect(prisma.agreementVersion.update({ where: { id: row.id }, data })).rejects.toThrow();
      }
    }
    expect(await firstRow(project.id)).toEqual(row);
  });

  // Prisma reports a trigger refusal as a generic error, so raw SQL proves which trigger fired.
  it.each([
    ["terms", `UPDATE "AgreementVersion" SET "agreementHash" = 'changed' WHERE "id" = ?`, /terms are immutable/],
    ["delete", 'DELETE FROM "AgreementVersion" WHERE "id" = ?', /cannot be deleted/],
    ["acceptance", 'UPDATE "AgreementVersion" SET "clientAcceptedAt" = NULL WHERE "id" = ?', /acceptance cannot be changed/],
  ])("the refusal comes from the trigger itself: %s", async (_label, sql, message) => {
    const { client, project, url } = await setup();
    await post(client, `${url}/agreement/accept`, { version: 1 });
    const row = await firstRow(project.id);
    await expect(prisma.$executeRawUnsafe(sql, row.id)).rejects.toThrow(message);
    expect(await firstRow(project.id)).toEqual(row);
  });

  it("the database still lets the first acceptance be recorded", async () => {
    const { project } = await setup();
    const row = await firstRow(project.id);
    const updated = await prisma.agreementVersion.update({
      where: { id: row.id },
      data: { freelancerAcceptedAt: new Date() },
    });
    expect(updated.freelancerAcceptedAt).not.toBeNull();
    expect(updated.agreementHash).toBe(row.agreementHash);
  });

  it("no API source file writes terms to AgreementVersion", () => {
    const sources = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .map((path) => readFileSync(join(srcDir, path), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toMatch(/agreementVersion\s*\.\s*(update|upsert|delete|deleteMany)\s*\(/);
      for (const match of source.matchAll(/agreementVersion\s*\.\s*updateMany\s*\(([\s\S]*?)\}\);/g)) {
        expect(match[1]).toMatch(/data: \{ \[acceptanceField\]: now\(\) \}/);
      }
    }
  });
});

describe("agreementHash", () => {
  const terms = {
    publicProjectId: "TRU-PROJ-2026-0000001",
    title: "t",
    description: "d",
    clientWallet: "client",
    freelancerWallet: "freelancer",
    arbiterWallet: "arbiter",
    chainId: 5042002,
    tokenAddress: "token",
    tokenDecimals: 6,
    milestones: [
      { onchainMilestoneId: "0x01", title: "a", amountBaseUnits: "1", deadline: DEADLINE, criteria: ["x", "y"] },
      { onchainMilestoneId: "0x02", title: "b", amountBaseUnits: "2", deadline: DEADLINE, criteria: ["z"] },
    ],
  };

  it("canonical JSON sorts keys at every level and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ f: 1, e: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[{"e":2,"f":1}]},"b":1}',
    );
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });

  it("is the SHA-256 of the stored canonical JSON", () => {
    const { criteriaJson, agreementHash } = hashAgreementTerms(terms);
    expect(agreementHash).toBe(sha256Hex(criteriaJson));
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", // secret-scan:allow
    );
  });

  it("does not depend on key order or milestone order", () => {
    const reordered = {
      ...Object.fromEntries(Object.entries(terms).reverse()),
      milestones: [...terms.milestones].reverse(),
    } as typeof terms;
    expect(hashAgreementTerms(reordered).agreementHash).toBe(hashAgreementTerms(terms).agreementHash);
  });

  it.each([
    ["title", { title: "other" }],
    ["description", { description: "other" }],
    ["freelancer", { freelancerWallet: "other" }],
    ["arbiter", { arbiterWallet: "other" }],
    ["chain", { chainId: 1 }],
    ["token", { tokenAddress: "other" }],
    ["project", { publicProjectId: "TRU-PROJ-2026-0000002" }],
  ])("changes when the %s changes", (_label, change) => {
    expect(hashAgreementTerms({ ...terms, ...change }).agreementHash).not.toBe(
      hashAgreementTerms(terms).agreementHash,
    );
  });

  it.each([
    ["amount", { amountBaseUnits: "9" }],
    ["deadline", { deadline: "2098-01-01T00:00:00.000Z" }],
    ["title", { title: "other" }],
    ["criteria", { criteria: ["y", "x"] }],
  ])("changes when a milestone's %s changes", (_label, change) => {
    const [first, second] = terms.milestones;
    const changed = { ...terms, milestones: [{ ...first!, ...change }, second!] };
    expect(hashAgreementTerms(changed).agreementHash).not.toBe(hashAgreementTerms(terms).agreementHash);
  });

  it("through the API: same terms keep the hash, changed terms change it", async () => {
    const { client, project, url } = await setup();
    const original = project.agreement.agreementHash;

    const same = await post(client, `${url}/agreement/versions`, sameTerms(project));
    expect(same.json().agreement.version).toBe(2);
    expect(same.json().agreement.agreementHash).toBe(original);

    const changed = await post(client, `${url}/agreement/versions`, sameTerms(project, { amount: "1" }));
    expect(changed.json().agreement.agreementHash).not.toBe(original);

    const back = await post(client, `${url}/agreement/versions`, sameTerms(project));
    expect(back.json().agreement.agreementHash).toBe(original);
  });

  it("through the API: equal deadlines in different spellings hash the same", async () => {
    const { client, project, url } = await setup();
    const res = await post(
      client,
      `${url}/agreement/versions`,
      sameTerms(project, { deadline: "2099-01-01T00:00:00Z" }),
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().agreement.agreementHash).toBe(project.agreement.agreementHash);
  });
});
