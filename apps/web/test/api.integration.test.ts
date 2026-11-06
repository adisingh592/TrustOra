/**
 * Integration test: real route handlers + real SQLite (scratch file) + a mocked Arc chain.
 * Run with TSX_TSCONFIG_PATH=apps/web/tsconfig.json so the "@/" alias resolves (see root package.json).
 * No network, no real keys: wallets are ephemeral in-test keys and the chain is an in-memory fake.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAgreementMessage, buildLoginMessage } from "../src/lib/siwe";
import { TRUSTORA_ESCROW_ABI, projectIdToBytes32, toUsdcBaseUnits } from "../../../packages/contracts/src/lib/arc";

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

const HOST = "localhost:3000";
const ESCROW = "0x1111111111111111111111111111111111111111";
const ARBITER_OWNER = "0x2222222222222222222222222222222222222222";

const client = privateKeyToAccount(generatePrivateKey());
const freelancer = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

let dir: string;
let db: PrismaClient;
let arcPublicClient: any;
const routes: Record<string, any> = {};

// ---- in-memory fake Arc chain ----
type Receipt = { status: "success" | "reverted"; from: string; to: string; blockNumber: bigint; logs: any[] };
const receipts = new Map<string, Receipt>();
const chain = {
  project: { client: client.address, freelancer: freelancer.address, arbiter: ARBITER_OWNER, exists: true },
  milestone: { criteriaHash: "0x", amount: 0n, state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" },
};
let txCounter = 0;
const newTx = () => `0x${(++txCounter).toString(16).padStart(64, "0")}`;

function evt(eventName: string, args: Record<string, unknown>, types: { type: string }[], values: unknown[]) {
  const topics = encodeEventTopics({ abi: TRUSTORA_ESCROW_ABI, eventName: eventName as never, args: args as never });
  const data = types.length ? encodeAbiParameters(types as never, values as never) : "0x";
  return { address: ESCROW, topics, data };
}
function mine(from: string, log: any, opts: { to?: string; status?: "success" | "reverted" } = {}) {
  const hash = newTx();
  receipts.set(hash, { status: opts.status ?? "success", from, to: opts.to ?? ESCROW, blockNumber: 100n + BigInt(txCounter), logs: [log] });
  return hash;
}

// ---- http helpers ----
async function call(handlerKey: string, opts: { method?: string; url?: string; cookie?: string; body?: unknown; params?: Record<string, string>; origin?: string; fn?: "GET" | "POST" } = {}) {
  const mod = routes[handlerKey];
  const method = opts.method ?? opts.fn ?? "POST";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const req = new Request(opts.url ?? `http://${HOST}/api/x`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const res: Response = await (mod[method] as Handler)(req, { params: opts.params ?? {} });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json, res };
}

async function login(account: ReturnType<typeof privateKeyToAccount>): Promise<string> {
  const n = await call("nonce");
  const now = new Date();
  const message = buildLoginMessage({
    domain: HOST,
    address: account.address,
    uri: `http://${HOST}`,
    chainId: 5042002,
    nonce: n.json.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 600_000).toISOString(),
  });
  const signature = await account.signMessage({ message });
  const v = await call("verify", { url: `http://${HOST}/api/auth/verify`, body: { message, signature } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const setCookie = v.res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  return setCookie.split(";")[0]!;
}

before(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("ZG_")) delete process.env[k]; // never call a real AI provider
  process.env.ESCROW_CONTRACT_ADDRESS = ESCROW;

  dir = mkdtempSync(join(tmpdir(), "trustora-it-"));
  const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8").replace("file:./dev.db", `file:${join(dir, "test.db")}`);
  const schemaPath = join(dir, "schema.prisma");
  writeFileSync(schemaPath, schema);
  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], {
    stdio: "pipe",
    // Prisma 5.22's SQLite schema engine otherwise exits with an empty error in this test setup.
    env: { ...process.env, RUST_LOG: "info" },
  });

  db = new PrismaClient({ datasourceUrl: `file:${join(dir, "test.db")}` });
  (globalThis as any).prisma = db; // lib/prisma.ts reuses this instead of opening dev.db

  arcPublicClient = (await import("../src/lib/arc")).arcPublicClient;
  arcPublicClient.getTransactionReceipt = async ({ hash }: { hash: string }) => {
    const r = receipts.get(hash);
    if (!r) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
    return r;
  };
  arcPublicClient.readContract = async ({ functionName }: { functionName: string }) =>
    functionName === "getProject" ? chain.project : chain.milestone;

  const p = "../src/app/api";
  routes.nonce = await import(`${p}/auth/nonce/route`);
  routes.verify = await import(`${p}/auth/verify/route`);
  routes.session = await import(`${p}/auth/session/route`);
  routes.logout = await import(`${p}/auth/logout/route`);
  routes.projects = await import(`${p}/projects/route`);
  routes.project = await import(`${p}/projects/[id]/route`);
  routes.invite = await import(`${p}/projects/[id]/invite/route`);
  routes.accept = await import(`${p}/projects/[id]/agreements/accept/route`);
  routes.register = await import(`${p}/projects/[id]/register/route`);
  for (const a of ["register", "fund", "submit", "release", "dispute", "refund", "revision", "resolve", "evaluate"]) {
    routes[`m_${a}`] = await import(`${p}/projects/[id]/milestones/[milestoneId]/${a}/route`);
  }
});

after(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Shared across the ordered tests below.
let cookieClient = "", cookieFreelancer = "", cookieStranger = "";
let projectId = "", milestoneId = "", criteriaHash = "";

test("every protected route rejects unauthenticated requests with 401", async () => {
  const P = { id: "TRU-PROJ-2026-0001042", milestoneId: "m1" };
  const checks: Array<[string, "GET" | "POST"]> = [
    ["projects", "GET"], ["projects", "POST"], ["project", "GET"], ["invite", "POST"], ["accept", "POST"], ["register", "POST"],
    ["m_register", "POST"], ["m_fund", "POST"], ["m_submit", "POST"], ["m_release", "POST"], ["m_dispute", "POST"],
    ["m_refund", "POST"], ["m_revision", "POST"], ["m_resolve", "POST"], ["m_evaluate", "POST"], ["logout", "POST"],
  ];
  for (const [key, method] of checks) {
    const r = await call(key, { method, params: P, body: { txHash: "0x" + "ab".repeat(32), role: "CLIENT", clientAddress: client.address } });
    if (key === "logout") assert.equal(r.status, 200); // logging out while logged out is harmless
    else assert.equal(r.status, 401, `${method} ${key}`);
  }
});

test("login: nonce is single-use, domain-bound, and sessions are HttpOnly + revocable", async () => {
  // replay: the same signed message cannot create a second session
  const n = await call("nonce");
  const now = new Date();
  const message = buildLoginMessage({ domain: HOST, address: client.address, uri: `http://${HOST}`, chainId: 5042002, nonce: n.json.nonce, issuedAt: now.toISOString(), expirationTime: new Date(now.getTime() + 600_000).toISOString() });
  const signature = await client.signMessage({ message });
  assert.equal((await call("verify", { body: { message, signature } })).status, 200);
  const replay = await call("verify", { body: { message, signature } });
  assert.equal(replay.status, 401);

  // a signature from another wallet / another domain / an unissued nonce is refused
  const n2 = await call("nonce");
  const mk = (over: object) => buildLoginMessage({ domain: HOST, address: client.address, uri: `http://${HOST}`, chainId: 5042002, nonce: n2.json.nonce, issuedAt: now.toISOString(), expirationTime: new Date(now.getTime() + 600_000).toISOString(), ...over });
  const m2 = mk({});
  assert.equal((await call("verify", { body: { message: m2, signature: await stranger.signMessage({ message: m2 }) } })).status, 401);
  const evil = mk({ domain: "evil.example" });
  assert.equal((await call("verify", { body: { message: evil, signature: await client.signMessage({ message: evil }) } })).status, 401);
  const unissued = mk({ nonce: "f".repeat(32) });
  assert.equal((await call("verify", { body: { message: unissued, signature: await client.signMessage({ message: unissued }) } })).status, 401);
  assert.equal((await call("verify", { body: {} })).status, 400);

  // session lifecycle
  cookieClient = await login(client);
  const s = await call("session", { method: "GET", cookie: cookieClient });
  assert.deepEqual([s.json.authenticated, s.json.address], [true, client.address.toLowerCase()]);
  assert.equal((await call("session", { method: "GET" })).json.authenticated, false);
  assert.equal((await call("logout", { cookie: cookieClient, origin: "https://evil.example" })).status, 403); // CSRF blocked
  const out = await call("logout", { cookie: cookieClient });
  assert.equal(out.status, 200);
  assert.equal((await call("session", { method: "GET", cookie: cookieClient })).json.authenticated, false);

  // the token in the DB is hashed, not the cookie value
  const raw = cookieClient.split("=")[1]!;
  assert.equal(await db.session.count({ where: { id: raw } }), 0);

  cookieClient = await login(client);
  cookieFreelancer = await login(freelancer);
  cookieStranger = await login(stranger);
});

test("create project: client is the session wallet, never the request body", async () => {
  const body = { title: "Escrow dashboard", description: "Build an escrow dashboard with tests", freelancerAddress: freelancer.address, budgetUsdc: "250", clientAddress: stranger.address, role: "FREELANCER" };
  const r = await call("projects", { cookie: cookieClient, body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.project.clientAddress, client.address.toLowerCase());
  assert.equal(r.json.project.freelancerAddress, freelancer.address.toLowerCase());
  assert.equal(r.json.project.status, "DRAFT");
  projectId = r.json.project.id;
  milestoneId = r.json.project.milestones[0].id;
  criteriaHash = r.json.project.milestones[0].criteriaHash;
  assert.equal(r.json.project.milestones[0].amountUsdc, 250);
  assert.match(criteriaHash, /^[0-9a-f]{64}$/);
});

test("create project validation", async () => {
  const base = { title: "T", description: "D", freelancerAddress: freelancer.address, budgetUsdc: "10" };
  for (const bad of [
    { ...base, freelancerAddress: undefined },
    { ...base, freelancerAddress: "0x123" },
    { ...base, freelancerAddress: client.address },
    { ...base, budgetUsdc: "1.1234567" },
    { ...base, budgetUsdc: "0" },
    { ...base, budgetUsdc: "-5" },
    { ...base, title: "" },
    { ...base, milestones: [{ title: "a", amountUsdc: "4" }, { title: "b", amountUsdc: "4" }] }, // sums to 8, not 10
    { ...base, milestones: [] },
    { ...base, customCriteria: [{ text: "" }] },
  ]) {
    const r = await call("projects", { cookie: cookieClient, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const ok = await call("projects", { cookie: cookieClient, body: { ...base, milestones: [{ title: "a", amountUsdc: "4" }, { title: "b", amountUsdc: "6" }] } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.project.milestones.map((m: any) => m.milestoneIndex), [1, 2]);
});

test("visibility: only participants can list or open a project", async () => {
  assert.ok((await call("projects", { method: "GET", cookie: cookieClient })).json.projects.some((p: any) => p.id === projectId));
  assert.ok((await call("projects", { method: "GET", cookie: cookieFreelancer })).json.projects.some((p: any) => p.id === projectId));
  assert.equal((await call("projects", { method: "GET", cookie: cookieStranger })).json.projects.length, 0);
  const own = await call("project", { method: "GET", cookie: cookieFreelancer, params: { id: projectId } });
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.viewer.roles, ["freelancer"]);
  assert.equal(own.json.chain.escrowAddress, ESCROW);
  assert.equal((await call("project", { method: "GET", cookie: cookieStranger, params: { id: projectId } })).status, 404);
});

test("client invitations are wallet-bound and freelancer assignment freezes when accepted", async () => {
  const assigned = await call("invite", { cookie: cookieClient, params: { id: projectId }, body: { freelancerAddress: freelancer.address } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.freelancerAddress, freelancer.address.toLowerCase());
  assert.equal((await call("invite", { cookie: cookieFreelancer, params: { id: projectId }, body: { freelancerAddress: stranger.address } })).status, 404);
  assert.equal((await call("invite", { cookie: cookieClient, params: { id: projectId }, body: { freelancerAddress: client.address } })).status, 400);
  assert.equal((await call("invite", { cookie: cookieStranger, params: { id: projectId }, body: { freelancerAddress: stranger.address } })).status, 404);
  const invite = await call("projects", { method: "GET", cookie: cookieFreelancer });
  assert.ok(invite.json.projects.some((p: any) => p.id === projectId), "assigned wallet sees its invitation");
});

test("on-chain registration and funding are refused until the agreement is locked", async () => {
  const tx = newTx();
  assert.equal((await call("register", { cookie: cookieClient, params: { id: projectId }, body: { txHash: tx } })).status, 409);
  const unknown = await call("m_fund", { cookie: cookieClient, params: { id: projectId, milestoneId }, body: { txHash: tx } });
  assert.equal(unknown.json.code, "RECEIPT_NOT_FOUND", "an unmined/unknown hash is never recorded");
  assert.equal(await mstate(), "UNFUNDED");
});

test("agreement acceptance: freelancer only, signature verified, then locked", async () => {
  const P = { id: projectId };
  assert.equal((await call("accept", { cookie: cookieClient, params: P, body: {} })).status, 403); // client already accepted
  assert.equal((await call("accept", { cookie: cookieStranger, params: P, body: {} })).status, 404);
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { role: "CLIENT" } })).status, 400); // no signature
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: "sig_freelancer_verified" } })).status, 401); // placeholder rejected

  const message = buildAgreementMessage({ projectId, versionNumber: 1, criteriaHash, role: "FREELANCER" });
  const wrongSigner = await stranger.signMessage({ message });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: wrongSigner } })).status, 401);
  const wrongMessage = await freelancer.signMessage({ message: buildAgreementMessage({ projectId, versionNumber: 1, criteriaHash: "0".repeat(64), role: "FREELANCER" }) });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: wrongMessage } })).status, 401);

  const ok = await call("accept", { cookie: cookieFreelancer, params: P, body: { signature: await freelancer.signMessage({ message }) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.bothAccepted, true);
  assert.equal((await db.project.findUnique({ where: { id: projectId } }))!.status, "AGREED");
  assert.equal((await call("invite", { cookie: cookieClient, params: P, body: { freelancerAddress: stranger.address } })).status, 409);
  const again = await call("accept", { cookie: cookieFreelancer, params: P, body: {} });
  assert.equal(again.json.alreadyAccepted, true);
});

test("register project on-chain: verified from the chain, never assumed from the DB", async () => {
  const P = { id: projectId };
  const pid = projectIdToBytes32(projectId);
  const created = (arbiter = ARBITER_OWNER) =>
    evt("ProjectCreated", { projectId: pid, client: client.address, freelancer: freelancer.address }, [{ type: "address" }, { type: "uint64" }], [arbiter, 1n]);

  // not the client / wrong sender / wrong contract / reverted
  const good = mine(client.address, created());
  assert.equal((await call("register", { cookie: cookieFreelancer, params: P, body: { txHash: good } })).status, 403);
  assert.equal((await call("register", { cookie: cookieStranger, params: P, body: { txHash: good } })).status, 404);
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(stranger.address, created()) } })).json.code, "SENDER_NOT_AUTHORIZED");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, created(), { to: "0x9999999999999999999999999999999999999999" }) } })).json.code, "WRONG_CONTRACT");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, created(), { status: "reverted" }) } })).json.code, "TX_REVERTED");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: newTx() } })).json.code, "RECEIPT_NOT_FOUND");
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: "nope" } })).json.code, "INVALID_TX_HASH");
  assert.equal((await db.project.findUnique({ where: { id: projectId } }))!.registerTxHash, null, "nothing recorded for rejected txs");
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } }), 0);

  const r = await call("register", { cookie: cookieClient, params: P, body: { txHash: good } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = await db.project.findUnique({ where: { id: projectId } });
  assert.equal(row!.registerTxHash, good);
  assert.equal(row!.arbiterAddress, ARBITER_OWNER, "adopts the arbiter the contract stores");
  const ev = await db.proofTrackEventRecord.findFirstOrThrow({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } });
  assert.equal(ev.verificationStatus, "VERIFIED");
  assert.equal(ev.referenceValue, good);
  assert.equal((await call("register", { cookie: cookieClient, params: P, body: { txHash: good } })).status, 200); // idempotent
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, eventType: "ESCROW_PROJECT_REGISTERED" } }), 1);
});

test("register milestone on-chain", async () => {
  const P = { id: projectId, milestoneId };
  const pid = projectIdToBytes32(projectId);
  const added = (amount: bigint, hash = "0x" + criteriaHash) =>
    evt("MilestoneAdded", { projectId: pid, milestoneId: 1n }, [{ type: "bytes32" }, { type: "uint256" }], [hash, amount]);
  chain.milestone = { criteriaHash: "0x" + criteriaHash, amount: toUsdcBaseUnits(250), state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" };

  assert.equal((await call("m_register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(249))) } })).json.code, "AMOUNT_MISMATCH");
  assert.equal((await call("m_register", { cookie: cookieClient, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(250), "0x" + "e".repeat(64))) } })).json.code, "CRITERIA_MISMATCH");
  assert.equal((await call("m_register", { cookie: cookieFreelancer, params: P, body: { txHash: mine(client.address, added(toUsdcBaseUnits(250))) } })).status, 403);
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.addTxHash, null);

  const good = mine(client.address, added(toUsdcBaseUnits(250)));
  const r = await call("m_register", { cookie: cookieClient, params: P, body: { txHash: good } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.addTxHash, good);
});

async function syncCall(action: string, who: string, txHash: string) {
  return call(`m_${action}`, { cookie: who, params: { id: projectId, milestoneId }, body: { txHash } });
}
const mstate = async () => (await db.milestone.findUnique({ where: { id: milestoneId } }))!.state;
const pstatus = async () => (await db.project.findUnique({ where: { id: projectId } }))!.status;

test("fund: role-gated, chain-verified, state read from the contract", async () => {
  const pid = projectIdToBytes32(projectId);
  const funded = evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 1n]);
  const tx = mine(client.address, funded);
  chain.milestone.state = 1; // Funded

  assert.equal((await syncCall("fund", cookieFreelancer, tx)).status, 403); // freelancer cannot fund
  assert.equal((await syncCall("fund", cookieStranger, tx)).status, 404);
  assert.equal(await mstate(), "UNFUNDED");
  assert.equal((await syncCall("fund", cookieClient, mine(stranger.address, funded))).json.code, "SENDER_NOT_AUTHORIZED");
  assert.equal(await mstate(), "UNFUNDED", "a rejected tx never changes state");

  const r = await syncCall("fund", cookieClient, tx);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.chainState, "Funded");
  assert.equal(await mstate(), "FUNDED");
  assert.equal(await pstatus(), "FUNDED");
  assert.equal((await db.milestone.findUnique({ where: { id: milestoneId } }))!.fundingTxHash, tx);
  const ev = await db.proofTrackEventRecord.findFirstOrThrow({ where: { projectId, referenceValue: tx } });
  assert.deepEqual([ev.ecosystem, ev.verificationStatus, ev.eventType], ["ARC", "VERIFIED", "ESCROW_FUNDED"]);
  assert.match(ev.explorerUrl ?? "", /^https:\/\/explorer\.testnet\.arc\.io\/tx\/0x/);

  const again = await syncCall("fund", cookieClient, tx); // idempotent
  assert.equal(again.status, 200);
  assert.equal(again.json.changed, false);
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, referenceValue: tx } }), 1);
});

test("submit: off-chain step does not change state; on-chain step must anchor the stored hash", async () => {
  const P = { id: projectId, milestoneId };
  const pid = projectIdToBytes32(projectId);
  assert.equal((await call("m_submit", { cookie: cookieClient, params: P, body: { deliverableContent: "x" } })).status, 403); // client cannot submit work
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "x", txHash: "0x1" } })).status, 400);

  const tooBig = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "z".repeat(24_001) } });
  assert.equal(tooBig.status, 413, "text the evaluator cannot fully read is refused, not silently truncated");
  assert.equal(await db.submission.count({ where: { milestoneId } }), 0);

  const content = "export function add(a:number,b:number){return a+b}";
  const stored = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: content, deliverableUri: "ipfs://real-cid" } });
  assert.equal(stored.status, 200, JSON.stringify(stored.json));
  assert.equal(await mstate(), "FUNDED", "storing text alone must not mark the milestone submitted");
  assert.equal(stored.json.anchor.deliverableHash, `0x${stored.json.deliverableHash}`);
  const submissionId = stored.json.submission.id;
  assert.equal(stored.json.submission.deliverableUri, "ipfs://real-cid");

  const submitted = (hash: string) => evt("MilestoneSubmitted", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "bytes32" }, { type: "string" }, { type: "uint64" }], [hash, "ipfs://real-cid", 1n]);
  chain.milestone.state = 2;
  chain.milestone.deliverableHash = stored.json.anchor.deliverableHash;
  const wrong = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { txHash: mine(freelancer.address, submitted("0x" + "f".repeat(64))), submissionId } });
  assert.equal(wrong.json.code, "DELIVERABLE_MISMATCH");
  assert.equal(await mstate(), "FUNDED");

  const ok = await call("m_submit", { cookie: cookieFreelancer, params: P, body: { txHash: mine(freelancer.address, submitted(stored.json.anchor.deliverableHash)), submissionId } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await mstate(), "SUBMITTED");
  assert.equal(await pstatus(), "IN_PROGRESS");
  // text can't be re-stored once submitted (state guard)
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: P, body: { deliverableContent: "again" } })).status, 409);
});

test("evaluate: client-only, explicit consent, honest UNABLE_TO_ASSESS without a model, never touches escrow", async () => {
  const P = { id: projectId, milestoneId };
  assert.equal((await call("m_evaluate", { cookie: cookieFreelancer, params: P, body: { aiConsent: true } })).status, 403);
  assert.equal((await call("m_evaluate", { cookie: cookieClient, params: P, body: {} })).json.code, "CONSENT_REQUIRED");
  assert.equal((await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: "yes" } })).status, 400);

  // Only the submission anchored on Arc is evaluated: a newer, never-anchored text and a tampered text are both refused/ignored.
  const anchored = await db.submission.findFirstOrThrow({ where: { milestoneId, anchorTxHash: { not: null } } });
  assert.ok(anchored.anchorTxHash, "the submit sync marks the anchored submission");
  const decoy = await db.submission.create({ data: { milestoneId, version: 99, deliverableHash: "9".repeat(64), content: "decoy never anchored" } });
  await db.submission.update({ where: { id: anchored.id }, data: { content: "tampered after anchoring" } });
  const tampered = await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: true } });
  assert.equal(tampered.status, 409, "stored text no longer matches the anchored hash");
  assert.match(tampered.json.error, /does not match its anchored hash/);
  await db.submission.update({ where: { id: anchored.id }, data: { content: anchored.content } });

  const r = await call("m_evaluate", { cookie: cookieClient, params: P, body: { aiConsent: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.report.submissionId, anchored.id, "evaluated the anchored submission, not the newer decoy");
  await db.submission.delete({ where: { id: decoy.id } });
  assert.equal(r.json.advisoryOnly, true);
  assert.equal(r.json.modelCalled, false);
  assert.equal(r.json.report.overallVerdict, "UNABLE_TO_ASSESS");
  assert.equal(r.json.report.inferenceRequestId, null, "no inference ID may be invented");
  assert.equal(r.json.report.advisoryNotice, "ADVISORY_ONLY_CANNOT_RELEASE_FUNDS");
  assert.equal(await mstate(), "SUBMITTED", "evaluation never moves escrow state");
  assert.equal(await db.proofTrackEventRecord.count({ where: { projectId, ecosystem: "ZERO_G" } }), 0);
  assert.equal(await db.agentPayment.count(), 0, "no simulated Hedera payment is recorded");
});

test("revision then resubmit, then dispute and refund paths are role- and chain-gated", async () => {
  const pid = projectIdToBytes32(projectId);
  const revision = evt("RevisionRequested", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "string" }], ["fix"]);
  chain.milestone.state = 3;
  assert.equal((await syncCall("revision", cookieFreelancer, mine(client.address, revision))).status, 403);
  assert.equal((await syncCall("revision", cookieClient, mine(client.address, revision))).status, 200);
  assert.equal(await mstate(), "REVISION_REQUESTED");

  // back to SUBMITTED (a legal contract transition), then refund by the freelancer is allowed; client cannot refund
  const submitted = evt("MilestoneSubmitted", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "bytes32" }, { type: "string" }, { type: "uint64" }], [chain.milestone.deliverableHash, "ipfs://real-cid", 2n]);
  chain.milestone.state = 2;
  const sub = await db.submission.findFirstOrThrow({ where: { milestoneId } });
  assert.equal((await call("m_submit", { cookie: cookieFreelancer, params: { id: projectId, milestoneId }, body: { txHash: mine(freelancer.address, submitted), submissionId: sub.id } })).status, 200);
  assert.equal(await mstate(), "SUBMITTED");

  const disputed = evt("MilestoneDisputed", { projectId: pid, milestoneId: 1n, initiator: freelancer.address }, [{ type: "string" }, { type: "uint64" }], ["unfair", 3n]);
  chain.milestone.state = 6;
  assert.equal((await syncCall("dispute", cookieStranger, mine(freelancer.address, disputed))).status, 404);
  assert.equal((await syncCall("dispute", cookieFreelancer, mine(freelancer.address, disputed))).status, 200);
  assert.equal(await mstate(), "DISPUTED");
  assert.equal(await pstatus(), "DISPUTED");

  // A regression is impossible: chain says Funded but DB is DISPUTED.
  chain.milestone.state = 1;
  const funded = evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 9n]);
  const reg = await syncCall("fund", cookieClient, mine(client.address, funded));
  assert.equal(reg.json.code, "INVALID_TRANSITION");
  assert.equal(await mstate(), "DISPUTED");

  // arbiter resolves with a full refund to the client
  const refunded = evt("MilestoneRefunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(250), 4n]);
  chain.milestone.state = 7;
  assert.equal((await syncCall("refund", cookieClient, mine(client.address, refunded))).status, 403); // client is not the refunding party
  assert.equal((await syncCall("refund", cookieFreelancer, mine(freelancer.address, refunded))).status, 200);
  assert.equal(await mstate(), "REFUNDED");
  assert.equal(await pstatus(), "COMPLETED");
});

test("release is client-authorized only and needs the contract to say Released", async () => {
  // fresh project for the happy-path release
  const body = { title: "Release flow", description: "Another escrow project", freelancerAddress: freelancer.address, budgetUsdc: "50" };
  const created = await call("projects", { cookie: cookieClient, body });
  const id = created.json.project.id as string;
  const mid = created.json.project.milestones[0].id as string;
  const hash = created.json.project.milestones[0].criteriaHash as string;
  const pid = projectIdToBytes32(id);
  const msg = buildAgreementMessage({ projectId: id, versionNumber: 1, criteriaHash: hash, role: "FREELANCER" });
  assert.equal((await call("accept", { cookie: cookieFreelancer, params: { id }, body: { signature: await freelancer.signMessage({ message: msg }) } })).status, 200);
  const proj = mine(client.address, evt("ProjectCreated", { projectId: pid, client: client.address, freelancer: freelancer.address }, [{ type: "address" }, { type: "uint64" }], [ARBITER_OWNER, 1n]));
  assert.equal((await call("register", { cookie: cookieClient, params: { id }, body: { txHash: proj } })).status, 200);
  chain.milestone = { criteriaHash: "0x" + hash, amount: toUsdcBaseUnits(50), state: 0, deliverableHash: "0x" + "0".repeat(64), deliverableUri: "" };
  const add = mine(client.address, evt("MilestoneAdded", { projectId: pid, milestoneId: 1n }, [{ type: "bytes32" }, { type: "uint256" }], ["0x" + hash, toUsdcBaseUnits(50)]));
  assert.equal((await call("m_register", { cookie: cookieClient, params: { id, milestoneId: mid }, body: { txHash: add } })).status, 200);

  const sync = (action: string, who: string, tx: string) => call(`m_${action}`, { cookie: who, params: { id, milestoneId: mid }, body: { txHash: tx } });
  chain.milestone.state = 1;
  assert.equal((await sync("fund", cookieClient, mine(client.address, evt("MilestoneFunded", { projectId: pid, milestoneId: 1n, client: client.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(50), 1n])))).status, 200);

  const released = evt("MilestoneReleased", { projectId: pid, milestoneId: 1n, freelancer: freelancer.address }, [{ type: "uint256" }, { type: "uint64" }], [toUsdcBaseUnits(50), 2n]);
  const releaseTx = mine(client.address, released);
  chain.milestone.state = 1; // the contract did NOT release
  assert.equal((await sync("release", cookieClient, releaseTx)).json.code, "CHAIN_STATE_BEHIND");
  assert.equal((await db.milestone.findUniqueOrThrow({ where: { id: mid } })).state, "FUNDED");
  chain.milestone.state = 5;
  assert.equal((await sync("release", cookieFreelancer, releaseTx)).status, 403); // freelancer cannot trigger release sync
  assert.equal((await sync("release", cookieClient, mine(freelancer.address, released))).json.code, "SENDER_NOT_AUTHORIZED"); // tx not sent by the on-chain client
  const ok = await sync("release", cookieClient, releaseTx);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.projectCompleted, true);
  const m = await db.milestone.findUniqueOrThrow({ where: { id: mid } });
  assert.deepEqual([m.state, m.releaseTxHash], ["RELEASED", releaseTx]);
});
