import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "./app.js";
import type { AuthConfig } from "./auth/config.js";
import { SESSION_COOKIE } from "./auth/session.js";
import type { prisma as Prisma } from "./db.js";

// This proves the real Fastify wiring (CORS headers, cookie flags, /ready) end
// to end, on top of the unit tests in cors.test.ts, serverConfig.test.ts and
// shutdown.test.ts. Runs the real migrations against a temporary database.
const apiDir = dirname(fileURLToPath(import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "trustora-deploy-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const FIXTURE_TOKEN = `0x${"0".repeat(39)}1`;
const config: AuthConfig = {
  domain: "trustora.test",
  sessionSecret: "test-only-secret-".repeat(3),
  isProduction: false,
};

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir.replace(/[\\/]src$/, ""),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("./db.js"));
  ({ buildApp } = await import("./app.js"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("GET /ready", () => {
  it("returns 200 { ready: true } when the database answers", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      database: "connected",
      timestamp: expect.any(String),
    });
    await app.close();
  });

  it("returns 503 { ready: false }, with no internals, when the database cannot answer", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN });
    await app.ready();
    const original = prisma.$queryRaw;
    // @ts-expect-error -- deliberately breaking the call for this one test
    prisma.$queryRaw = () => Promise.reject(new Error("ECONNREFUSED at /var/secret/path.db:1:1"));
    try {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        ok: false,
        database: "disconnected",
        timestamp: expect.any(String),
      });
      for (const forbidden of ["ECONNREFUSED", "secret", "Error", "at "]) {
        expect(res.body).not.toContain(forbidden);
      }
    } finally {
      prisma.$queryRaw = original;
      await app.close();
    }
  });

  it("needs no session", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN });
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
    await app.close();
  });
});

describe("CORS", () => {
  const WEB_ORIGIN = "https://app.example.invalid";

  it("allows the configured origin, with credentials, and never a literal wildcard", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, webOrigins: [WEB_ORIGIN] });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: WEB_ORIGIN } });
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("refuses an origin that is not configured", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, webOrigins: [WEB_ORIGIN] });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("with no origins configured, every cross-origin request is refused, never allowed by default", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, webOrigins: [] });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://anything.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("a request with no Origin header is unaffected (not a CORS request)", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, webOrigins: [] });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("handles a preflight OPTIONS request for the configured origin", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, webOrigins: [WEB_ORIGIN] });
    await app.ready();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/auth/verify-wallet",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    await app.close();
  });
});

describe("cookie SameSite=none (cross-site web app)", () => {
  it("is Secure even outside production, unlike the Lax default", async () => {
    const crossSite: AuthConfig = { ...config, cookieSameSite: "none" };
    const app = buildApp({ config: crossSite, logger: false, tokenAddress: FIXTURE_TOKEN });
    await app.ready();
    const nonce = await app.inject({ method: "POST", url: "/auth/nonce" });
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify-wallet",
      payload: { message: nonce.json().message, signature: "0x00" },
    });
    // The signature is deliberately invalid; only the cookie-building code path matters here,
    // so assert on logout's Set-Cookie instead, which always runs.
    const logout = await app.inject({ method: "POST", url: "/auth/logout" });
    const cookie = logout.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.sameSite).toBe("None");
    expect(cookie.secure).toBe(true);
    await app.close();
    void res;
  });

  it("an invalid COOKIE_SAMESITE value is rejected at config load, not silently accepted", async () => {
    const { loadAuthConfig } = await import("./auth/config.js");
    expect(() => loadAuthConfig({ COOKIE_SAMESITE: "strict" })).toThrow(/COOKIE_SAMESITE/);
  });

  it("COOKIE_SAMESITE=none from the real environment also forces Secure", async () => {
    const { loadAuthConfig } = await import("./auth/config.js");
    const loaded = loadAuthConfig({ COOKIE_SAMESITE: "NONE" });
    expect(loaded.cookieSameSite).toBe("none");
    expect(loaded.cookieSecure).toBe(true);
  });
});

describe("trustProxy", () => {
  // With trustProxy off, Fastify ignores X-Forwarded-For; with it on, request.ip
  // reflects the proxy's header. Behaviour, not internal config shape.
  it("defaults to false: a forwarded header is ignored", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, trustProxy: false });
    app.get("/__ip", async (request) => ({ ip: request.ip }));
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.json().ip).not.toBe("203.0.113.9");
    await app.close();
  });

  it("TRUST_PROXY=true: a forwarded header is honoured", async () => {
    const app = buildApp({ config, logger: false, tokenAddress: FIXTURE_TOKEN, trustProxy: true });
    app.get("/__ip", async (request) => ({ ip: request.ip }));
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.json().ip).toBe("203.0.113.9");
    await app.close();
  });
});
