// MOCK_ fetch only: these tests prove adapter LOGIC, not that 0G works. See scripts/smoke.ts for the real call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RouterClient, routerConfigFromEnv, MAINNET_ROUTER_HOST } from "../src/router";
import { OgError } from "../src/types";

type Call = { url: string; init: RequestInit };
function MOCK_fetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const okBody = (extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-body-id",
  model: "MOCK_model-x",
  choices: [{ message: { role: "assistant", content: "hello" } }],
  ...extra,
});
const cfg = { apiKey: "sk-MOCK", baseUrl: "https://router-api-testnet.integratenetwork.work/v1", model: "MOCK_model-x" };
const req = { system: "sys", user: "usr" };
const readBody = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => new Headers(c.init.headers).get(k);

test("sends bearer key, messages, temperature, max_tokens and verify_tee:true", async () => {
  const m = MOCK_fetch(() => json(okBody({ x_0g_trace: { request_id: "req-1", provider: "0xP", tee_verified: true } })));
  await new RouterClient({ ...cfg, fetchImpl: m.fn }).chat({ ...req, temperature: 0.1, maxTokens: 500 });
  const c = m.calls[0]!;
  assert.equal(c.url, `${cfg.baseUrl}/chat/completions`);
  assert.equal(hdr(c, "authorization"), "Bearer sk-MOCK");
  const b = readBody(c);
  assert.equal(b.verify_tee, true);
  assert.equal(b.model, "MOCK_model-x");
  assert.equal(b.temperature, 0.1);
  assert.equal(b.max_tokens, 500);
  assert.deepEqual(b.messages, [{ role: "system", content: "sys" }, { role: "user", content: "usr" }]);
});

test("trust-mode header is opt-in only", async () => {
  const body = okBody({ x_0g_trace: { request_id: "r" } });
  const a = MOCK_fetch(() => json(body));
  await new RouterClient({ ...cfg, fetchImpl: a.fn }).chat(req);
  assert.equal(hdr(a.calls[0]!, "x-0g-provider-trust-mode"), null);
  const b = MOCK_fetch(() => json(body));
  await new RouterClient({ ...cfg, trustMode: "private", providerAddress: "0xPIN", fetchImpl: b.fn }).chat(req);
  assert.equal(hdr(b.calls[0]!, "x-0g-provider-trust-mode"), "private");
  assert.equal(hdr(b.calls[0]!, "x-0g-provider-address"), "0xPIN");
});

test("request id priority: x_0g_trace > ZG-Res-Key > body id", async () => {
  const mk = (body: object, headers: Record<string, string>) =>
    new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json(body, 200, headers)).fn }).chat(req);
  const a = await mk(okBody({ x_0g_trace: { request_id: "TRACE" } }), { "ZG-Res-Key": "HDR" });
  assert.deepEqual([a.requestId, a.requestIdSource], ["TRACE", "x_0g_trace.request_id"]);
  const b = await mk(okBody(), { "ZG-Res-Key": "HDR" });
  assert.deepEqual([b.requestId, b.requestIdSource, b.chatId], ["HDR", "ZG-Res-Key", "HDR"]);
  const c = await mk(okBody(), {});
  assert.deepEqual([c.requestId, c.requestIdSource], ["chatcmpl-body-id", "body.id"]);
});

test("no request id anywhere -> NO_REQUEST_ID, never invented", async () => {
  const body = { model: "m", choices: [{ message: { content: "x" } }] };
  const c = new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json(body)).fn });
  await assert.rejects(c.chat(req), (e: unknown) => e instanceof OgError && e.code === "NO_REQUEST_ID");
});

test("TEE flag is labelled router-reported; absent flag -> null/null", async () => {
  const t = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json(okBody({ x_0g_trace: { request_id: "r", provider: "0xP", tee_verified: true } }))).fn }).chat(req);
  assert.equal(t.teeVerified, true);
  assert.equal(t.teeVerifiedBy, "router-reported");
  assert.equal(t.providerAddress, "0xP");
  const f = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json(okBody({ x_0g_trace: { request_id: "r", tee_verified: false } }))).fn }).chat(req);
  assert.equal(f.teeVerified, false);
  const n = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json(okBody({ x_0g_trace: { request_id: "r" } }))).fn }).chat(req);
  assert.equal(n.teeVerified, null);
  assert.equal(n.teeVerifiedBy, null);
});

test("HTTP / network errors map to OgError codes", async () => {
  const code = async (r: () => Response | Promise<Response>) => {
    try { await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(r).fn }).chat(req); return "none"; }
    catch (e) { return e instanceof OgError ? e.code : "other"; }
  };
  assert.equal(await code(() => json({}, 401)), "NOT_CONFIGURED");
  assert.equal(await code(() => json({}, 403)), "NOT_CONFIGURED");
  assert.equal(await code(() => json({}, 402)), "INSUFFICIENT_FUNDS");
  assert.equal(await code(() => json({}, 429)), "UNAVAILABLE");
  assert.equal(await code(() => json({}, 503)), "UNAVAILABLE");
  assert.equal(await code(() => { throw new Error("ECONNRESET"); }), "UNAVAILABLE");
  assert.equal(await code(() => new Response("not json", { status: 200 })), "BAD_RESPONSE");
  assert.equal(await code(() => json({ id: "x", choices: [] })), "BAD_RESPONSE");
});

test("timeout -> UNAVAILABLE", async () => {
  const slow = ((_u: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
  const c = new RouterClient({ ...cfg, fetchImpl: slow });
  await assert.rejects(c.chat({ ...req, timeoutMs: 20 }), (e: unknown) => e instanceof OgError && e.code === "UNAVAILABLE");
});

test("model auto-picks first id of GET /models when not configured; listModels works", async () => {
  const m = MOCK_fetch((c) =>
    c.url.endsWith("/models") ? json({ data: [{ id: "MOCK_first" }, { id: "MOCK_second" }] }) : json(okBody({ x_0g_trace: { request_id: "r" } })));
  const client = new RouterClient({ apiKey: "sk-MOCK", baseUrl: cfg.baseUrl, fetchImpl: m.fn });
  assert.deepEqual(await client.listModels(), ["MOCK_first", "MOCK_second"]);
  await client.chat(req);
  const chatCall = m.calls.find((c) => c.url.endsWith("/chat/completions"))!;
  assert.equal(readBody(chatCall).model, "MOCK_first");
});

test("healthCheck: CONFIGURED when reachable, never CONNECTED/VERIFIED; failure states mapped", async () => {
  const ok = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json({ data: [{ id: "m" }] })).fn }).healthCheck();
  assert.equal(ok.status, "CONFIGURED");
  const bad = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => json({}, 401)).fn }).healthCheck();
  assert.equal(bad.status, "NOT_CONFIGURED");
  const down = await new RouterClient({ ...cfg, fetchImpl: MOCK_fetch(() => { throw new Error("down"); }).fn }).healthCheck();
  assert.equal(down.status, "UNAVAILABLE");
});

test("routerConfigFromEnv: needs key, refuses mainnet host, defaults to testnet", () => {
  assert.equal(routerConfigFromEnv({}), null);
  const d = routerConfigFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK" })!;
  assert.equal(d.baseUrl, "https://router-api-testnet.integratenetwork.work/v1");
  assert.throws(() => routerConfigFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK", ZG_ROUTER_BASE_URL: `https://${MAINNET_ROUTER_HOST}/v1` }), /mainnet/i);
  const e = routerConfigFromEnv({ ZG_ROUTER_API_KEY: "sk-MOCK", ZG_ROUTER_MODEL: "m1", ZG_ROUTER_TRUST_MODE: "private", ZG_ROUTER_PROVIDER_ADDRESS: "0xA" })!;
  assert.deepEqual([e.model, e.trustMode, e.providerAddress], ["m1", "private", "0xA"]);
});

test("error messages never contain the API key", async () => {
  const c = new RouterClient({ ...cfg, apiKey: "sk-SECRET-123", fetchImpl: MOCK_fetch(() => json({ error: "bad sk-SECRET-123" }, 401)).fn });
  await assert.rejects(c.chat(req), (e: unknown) => e instanceof Error && !e.message.includes("sk-SECRET-123"));
});
