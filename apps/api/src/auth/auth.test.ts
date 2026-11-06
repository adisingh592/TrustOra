import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { buildApp as BuildApp } from "../app.js";
import type { prisma as Prisma } from "../db.js";
import { type AuthConfig, loadAuthConfig } from "./config.js";
import { createPrismaNonceStore } from "./nonceStore.js";
import { createSessionCodec, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.js";
import { upsertUserByWallet } from "./users.js";

// Runs the real migrations against a temporary database, never dev.db.
// Wallets are throwaway viem keys generated per run.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(srcDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-auth-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

const DOMAIN = "trustora.test";
const SECRET = "test-only-secret-".repeat(3);
const config: AuthConfig = { domain: DOMAIN, sessionSecret: SECRET, isProduction: false };

let prisma: typeof Prisma;
let buildApp: typeof BuildApp;
let app: ReturnType<typeof BuildApp>;
let current: Date;

const now = () => current;
const newWallet = () => privateKeyToAccount(generatePrivateKey());
const advanceMs = (ms: number) => {
  current = new Date(current.getTime() + ms);
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
  app = buildApp({ config, logger: false, now });
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

const post = (url: string, payload?: object, cookies?: Record<string, string>) =>
  app.inject({ method: "POST", url, ...(payload ? { payload } : {}), ...(cookies ? { cookies } : {}) });

const getNonce = async (address?: string) => {
  const res = await post("/auth/nonce", address ? { address } : {});
  expect(res.statusCode).toBe(200);
  return res.json<{ nonce: string; message: string; expiresAt: string }>();
};

const signedRequest = async (address?: string) => {
  const wallet = newWallet();
  const { message } = await getNonce(address ?? wallet.address);
  return { wallet, message, signature: await wallet.signMessage({ message }) };
};

const signIn = async () => {
  const { wallet, message, signature } = await signedRequest();
  const res = await post("/auth/verify-wallet", { message, signature });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  return { wallet, res, cookie, body: res.json<{ address: string; userId: string }>() };
};

const me = (token: string) =>
  app.inject({ method: "GET", url: "/auth/me", cookies: { [SESSION_COOKIE]: token } });

const expect401 = (res: Awaited<ReturnType<typeof post>>, code: string) => {
  expect(res.statusCode, res.body).toBe(401);
  const { error } = res.json<{ error: { code: string; message: string } }>();
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(0);
};

describe("POST /auth/nonce", () => {
  it("returns a nonce, a readable message and an expiry", async () => {
    const res = await post("/auth/nonce", {});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "message", "nonce"]);
    expect(body.message).toContain(`${DOMAIN} wants you to sign in`);
    expect(body.message).toContain("Chain ID: 5042002");
    expect(body.message).toContain("<wallet address>");
  });

  it("works with no body at all", async () => {
    expect((await app.inject({ method: "POST", url: "/auth/nonce" })).statusCode).toBe(200);
  });

  it("lowercases the address and stores it lowercase", async () => {
    const wallet = newWallet();
    const { nonce, message } = await getNonce(wallet.address);
    expect(message).toContain(wallet.address.toLowerCase());
    const row = await prisma.authNonce.findUniqueOrThrow({ where: { nonce } });
    expect(row.address).toBe(wallet.address.toLowerCase());
  });

  it.each([["0x123"], ["not-an-address"], [42], [null]])(
    "rejects a bad address with 400: %s",
    async (address) => {
      const res = await post("/auth/nonce", { address } as object);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_INPUT");
    },
  );

  it("rejects unparseable JSON with 400, not 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/nonce",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_INPUT");
  });
});

describe("POST /auth/verify-wallet", () => {
  it("valid flow: signs in, sets the cookie, and /auth/me works", async () => {
    const { wallet, res, cookie, body } = await signIn();
    const address = wallet.address.toLowerCase();
    expect(body.address).toBe(address);
    expect(res.json()).toEqual({ address, userId: body.userId });

    const user = await prisma.user.findUniqueOrThrow({ where: { walletAddress: address } });
    expect(user.id).toBe(body.userId);

    const profile = await me(cookie.value);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual({ address, userId: body.userId });
  });

  it("works when the address is only known after the wallet connects", async () => {
    const wallet = newWallet();
    const { message } = await getNonce();
    const filled = message.replace("<wallet address>", wallet.address);
    const res = await post("/auth/verify-wallet", {
      message: filled,
      signature: await wallet.signMessage({ message: filled }),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().address).toBe(wallet.address.toLowerCase());
  });

  it("sets an httpOnly, SameSite=Lax, 24 hour cookie, not Secure outside production", async () => {
    const { cookie } = await signIn();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(cookie.maxAge).toBe(86400);
    expect(cookie.path).toBe("/");
    expect(cookie.secure).toBeUndefined();
  });

  it("sets a Secure cookie in production", async () => {
    const productionApp = buildApp({ config: { ...config, isProduction: true }, logger: false, now });
    const wallet = newWallet();
    const nonce = await productionApp.inject({ method: "POST", url: "/auth/nonce", payload: { address: wallet.address } });
    const { message } = nonce.json();
    const res = await productionApp.inject({
      method: "POST",
      url: "/auth/verify-wallet",
      payload: { message, signature: await wallet.signMessage({ message }) },
    });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.secure).toBe(true);
    await productionApp.close();
  });

  it("rejects a replayed nonce with 401", async () => {
    const { message, signature } = await signedRequest();
    expect((await post("/auth/verify-wallet", { message, signature })).statusCode).toBe(200);
    expect401(await post("/auth/verify-wallet", { message, signature }), "NONCE_USED");
  });

  it("rejects an expired nonce with 401", async () => {
    const { message, signature } = await signedRequest();
    advanceMs(5 * 60 * 1000);
    expect401(await post("/auth/verify-wallet", { message, signature }), "NONCE_EXPIRED");
  });

  it("rejects a wrong chainId with 401, even when correctly signed", async () => {
    const { wallet, message } = await signedRequest();
    const forged = message.replace("Chain ID: 5042002", "Chain ID: 1");
    expect401(
      await post("/auth/verify-wallet", { message: forged, signature: await wallet.signMessage({ message: forged }) }),
      "CHAIN_MISMATCH",
    );
  });

  it("rejects a wrong domain with 401, even when correctly signed", async () => {
    const { wallet, message } = await signedRequest();
    const forged = message.replace(`${DOMAIN} wants`, "evil.test wants");
    expect401(
      await post("/auth/verify-wallet", { message: forged, signature: await wallet.signMessage({ message: forged }) }),
      "DOMAIN_MISMATCH",
    );
  });

  it("rejects a signature from another wallet with 401", async () => {
    const { message } = await signedRequest();
    expect401(
      await post("/auth/verify-wallet", { message, signature: await newWallet().signMessage({ message }) }),
      "SIGNATURE_INVALID",
    );
  });

  it("rejects a nonce for address A used by address B with 401", async () => {
    const { wallet: a, message } = await signedRequest();
    const b = newWallet();
    const forged = message.replace(a.address.toLowerCase(), b.address);
    expect(forged).not.toBe(message);
    expect401(
      await post("/auth/verify-wallet", { message: forged, signature: await b.signMessage({ message: forged }) }),
      "ADDRESS_MISMATCH",
    );
  });

  it.each<[string, object | undefined, string]>([
    ["no body", undefined, "MALFORMED_MESSAGE"],
    ["empty object", {}, "MALFORMED_MESSAGE"],
    ["missing signature", { message: "x" }, "MALFORMED_SIGNATURE"],
    ["missing message", { signature: "0x" }, "MALFORMED_MESSAGE"],
    ["wrong types", { message: 1, signature: 2 }, "MALFORMED_MESSAGE"],
    ["null values", { message: null, signature: null }, "MALFORMED_MESSAGE"],
    ["array message", { message: ["x"], signature: "0x" }, "MALFORMED_MESSAGE"],
    ["garbage message", { message: "let me in", signature: `0x${"ab".repeat(65)}` }, "MALFORMED_MESSAGE"],
    ["very long message", { message: "a".repeat(100_000), signature: `0x${"ab".repeat(65)}` }, "MALFORMED_MESSAGE"],
  ])("rejects malformed input with 401, not 500: %s", async (_label, payload, code) => {
    expect401(await post("/auth/verify-wallet", payload), code);
  });

  it.each([["not hex"], ["0x1234"], [""]])("rejects a malformed signature with 401: %s", async (signature) => {
    const { message } = await signedRequest();
    expect401(await post("/auth/verify-wallet", { message, signature }), "MALFORMED_SIGNATURE");
  });

  it.each([[`0x${"ff".repeat(65)}`], [`0x${"00".repeat(65)}`]])(
    "rejects a right-length signature that cannot recover with 401",
    async (signature) => {
      const { message } = await signedRequest();
      expect401(await post("/auth/verify-wallet", { message, signature }), "SIGNATURE_INVALID");
    },
  );

  it.each<[string, Record<string, string>, string]>([
    ["unparseable JSON", { "content-type": "application/json" }, "{not json"],
    ["empty JSON body", { "content-type": "application/json" }, ""],
    ["unsupported content type", { "content-type": "application/xml" }, "<a/>"],
    ["plain text", { "content-type": "text/plain" }, "hello"],
  ])("rejects an unusable body with 401, not 500: %s", async (_label, headers, payload) => {
    const res = await app.inject({ method: "POST", url: "/auth/verify-wallet", headers, payload });
    expect401(res, "MALFORMED_MESSAGE");
  });

  it("does not set a cookie or create a user when sign-in fails", async () => {
    const { wallet, message } = await signedRequest();
    const res = await post("/auth/verify-wallet", { message, signature: await newWallet().signMessage({ message }) });
    expect(res.cookies).toHaveLength(0);
    const user = await prisma.user.findUnique({ where: { walletAddress: wallet.address.toLowerCase() } });
    expect(user).toBeNull();
  });
});

describe("parallel sign-ins against the database store", () => {
  it("two parallel verifies with one nonce: exactly one succeeds", async () => {
    const { message, signature } = await signedRequest();
    const results = await Promise.all([
      post("/auth/verify-wallet", { message, signature }),
      post("/auth/verify-wallet", { message, signature }),
    ]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 401]);
    expect401(results.find((r) => r.statusCode === 401)!, "NONCE_USED");
  });

  it("ten parallel verifies with one nonce: exactly one succeeds, none is a 500", async () => {
    const { message, signature } = await signedRequest();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post("/auth/verify-wallet", { message, signature })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(9);
  });

  it("consume is atomic at the store: of many parallel calls exactly one wins", async () => {
    const store = createPrismaNonceStore(prisma);
    const { nonce } = await getNonce();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.consume(nonce, new Date())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await prisma.authNonce.findUniqueOrThrow({ where: { nonce } });
    expect(row.usedAt).not.toBeNull();
  });

  it("consume refuses an expired nonce and an unknown nonce", async () => {
    const store = createPrismaNonceStore(prisma);
    const { nonce, expiresAt } = await getNonce();
    expect(await store.consume(nonce, new Date(expiresAt))).toBe(false);
    expect(await store.consume("unknown", new Date())).toBe(false);
  });

  it("two parallel sign-ins by the same new wallet make one user, no 500", async () => {
    const wallet = newWallet();
    const attempt = async () => {
      const { message } = await getNonce(wallet.address);
      return post("/auth/verify-wallet", { message, signature: await wallet.signMessage({ message }) });
    };
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const rows = await prisma.user.findMany({ where: { walletAddress: wallet.address.toLowerCase() } });
    expect(rows).toHaveLength(1);
  });
});

describe("SEC-001: wallet addresses are stored lowercase", () => {
  it("a checksum-case address is stored lowercase", async () => {
    const wallet = newWallet();
    expect(wallet.address).not.toBe(wallet.address.toLowerCase());
    const { message } = await getNonce();
    const filled = message.replace("<wallet address>", wallet.address);
    const res = await post("/auth/verify-wallet", {
      message: filled,
      signature: await wallet.signMessage({ message: filled }),
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.json().userId } });
    expect(row.walletAddress).toBe(wallet.address.toLowerCase());
  });

  it("the same wallet in checksum and lowercase is one account", async () => {
    const wallet = newWallet();
    const signInWith = async (address: string) => {
      const { message } = await getNonce();
      const filled = message.replace("<wallet address>", address);
      return post("/auth/verify-wallet", {
        message: filled,
        signature: await wallet.signMessage({ message: filled }),
      });
    };
    const first = await signInWith(wallet.address);
    const second = await signInWith(wallet.address.toLowerCase());
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().userId).toBe(first.json().userId);
  });

  it("upsertUserByWallet lowercases by itself, whatever the caller passes", async () => {
    const wallet = newWallet();
    const first = await upsertUserByWallet(prisma, wallet.address);
    expect(first.walletAddress).toBe(wallet.address.toLowerCase());
    const second = await upsertUserByWallet(prisma, wallet.address.toLowerCase());
    expect(second.id).toBe(first.id);
    const upper = `0x${wallet.address.slice(2).toUpperCase()}`;
    expect((await upsertUserByWallet(prisma, upper)).id).toBe(first.id);
  });

  it.each([["0x123"], ["not-an-address"], [""]])(
    "upsertUserByWallet refuses a non-address: %s",
    (address) => {
      expect(() => upsertUserByWallet(prisma, address)).toThrow();
    },
  );

  it("no source file except auth/users.ts writes User.walletAddress", () => {
    const sourceFiles = (readdirSync(srcDir, { recursive: true }) as string[])
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
    expect(sourceFiles).toContain("auth/users.ts");
    const offenders = sourceFiles.filter(
      // A write is `walletAddress: x` or shorthand. Reading user.walletAddress is fine.
      (path) => path !== "auth/users.ts" && /(?<!\.)\bwalletAddress\s*[:,}]/.test(readFileSync(join(srcDir, path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("sessions", () => {
  it("GET /auth/me returns 401 with no cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect401(res, "UNAUTHENTICATED");
  });

  it("rejects a tampered cookie: a different userId with the old signature", async () => {
    const { cookie } = await signIn();
    const { userId: otherUser } = (await signIn()).body;
    const [payload, signature] = cookie.value.split(".") as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...decoded, userId: otherUser })).toString("base64url");
    expect401(await me(`${forged}.${signature}`), "UNAUTHENTICATED");
  });

  it("rejects a tampered cookie: a later expiry with the old signature", async () => {
    const { cookie } = await signIn();
    const [payload, signature] = cookie.value.split(".") as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...decoded, exp: decoded.exp + 999999 })).toString("base64url");
    expect401(await me(`${forged}.${signature}`), "UNAUTHENTICATED");
  });

  it("rejects every single-character change to the signature", async () => {
    const { cookie } = await signIn();
    const [payload, signature] = cookie.value.split(".") as [string, string];
    for (let i = 0; i < signature.length; i += 1) {
      const swapped = signature[i] === "A" ? "B" : "A";
      const changed = signature.slice(0, i) + swapped + signature.slice(i + 1);
      expect401(await me(`${payload}.${changed}`), "UNAUTHENTICATED");
    }
  });

  it.each([
    ["empty", ""],
    ["no separator", "abc"],
    ["too many parts", "a.b.c"],
    ["not base64", "%%%.%%%"],
  ])("rejects a malformed cookie: %s", async (_label, token) => {
    expect401(await me(token), "UNAUTHENTICATED");
  });

  it("rejects a correctly signed cookie with a broken payload", async () => {
    const sessions = createSessionCodec(SECRET, now);
    const good = sessions.sign("user").split(".")[1]!;
    expect(sessions.verify(`not-json.${good}`)).toBeNull();
    const hmac = (await import("node:crypto")).createHmac;
    const signWith = (payload: object) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${encoded}.${hmac("sha256", SECRET).update(encoded).digest("base64url")}`;
    };
    expect(sessions.verify(signWith({ userId: "user" }))).toBeNull();
    expect(sessions.verify(signWith({ userId: "user", exp: "soon" }))).toBeNull();
    expect(sessions.verify(signWith({ exp: 9999999999 }))).toBeNull();
    expect(sessions.verify(signWith({ userId: "user", exp: 9999999999 }))).not.toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const { body } = await signIn();
    const forged = createSessionCodec("another-secret-".repeat(4), now).sign(body.userId);
    expect401(await me(forged), "UNAUTHENTICATED");
  });

  it("rejects an expired cookie, exactly at 24 hours", async () => {
    const { cookie } = await signIn();
    const issuedSecond = Math.floor(current.getTime() / 1000);
    current = new Date((issuedSecond + SESSION_TTL_SECONDS - 1) * 1000);
    expect((await me(cookie.value)).statusCode).toBe(200);
    current = new Date((issuedSecond + SESSION_TTL_SECONDS) * 1000);
    expect401(await me(cookie.value), "UNAUTHENTICATED");
  });

  it("rejects a valid cookie for a user who no longer exists", async () => {
    const token = createSessionCodec(SECRET, now).sign("no-such-user");
    expect401(await me(token), "UNAUTHENTICATED");
  });

  it("requireUser rejects a route without a valid cookie and allows one with it", async () => {
    const guarded = buildApp({ config, logger: false, now });
    guarded.get("/guarded", { preHandler: guarded.requireUser }, async (request) => ({
      userId: request.userId,
    }));
    await guarded.ready();
    const blocked = await guarded.inject({ method: "GET", url: "/guarded" });
    expect(blocked.statusCode).toBe(401);
    const token = createSessionCodec(SECRET, now).sign("user-1");
    const allowed = await guarded.inject({
      method: "GET",
      url: "/guarded",
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ userId: "user-1" });
    await guarded.close();
  });

  it("POST /auth/logout clears the cookie", async () => {
    const { cookie } = await signIn();
    const res = await post("/auth/logout", undefined, { [SESSION_COOKIE]: cookie.value });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cleared.value).toBe("");
    expect(cleared.expires?.getTime() ?? 0).toBeLessThan(Date.now());
  });

  it("POST /auth/logout works when not signed in", async () => {
    expect((await post("/auth/logout")).statusCode).toBe(200);
  });
});

describe("config", () => {
  const production = (SESSION_SECRET?: string) =>
    loadAuthConfig({ NODE_ENV: "production", ...(SESSION_SECRET !== undefined ? { SESSION_SECRET } : {}) });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["31 characters", "x".repeat(31)],
  ])("refuses to start in production when SESSION_SECRET is %s", (_label, secret) => {
    expect(() => production(secret)).toThrow(/Refusing to start/);
  });

  it("does not put the secret in the error", () => {
    const secret = "visible-secret-value";
    expect(() => production(secret)).toThrow();
    try {
      production(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("accepts a 32 character secret in production and marks it production", () => {
    const secret = "x".repeat(32);
    expect(production(secret)).toEqual({ domain: "localhost:3001", sessionSecret: secret, isProduction: true });
  });

  it("uses a random secret per process outside production, never a fixed one", () => {
    const a = loadAuthConfig({ NODE_ENV: "development" });
    const b = loadAuthConfig({ NODE_ENV: "development" });
    expect(a.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(a.sessionSecret).not.toBe(b.sessionSecret);
  });

  it("reads AUTH_DOMAIN, defaults when empty, and rejects spaces", () => {
    expect(loadAuthConfig({ AUTH_DOMAIN: "app.test" }).domain).toBe("app.test");
    expect(loadAuthConfig({ AUTH_DOMAIN: "" }).domain).toBe("localhost:3001");
    expect(() => loadAuthConfig({ AUTH_DOMAIN: "a b" })).toThrow(/spaces/);
  });
});

describe("logs", () => {
  const capture = () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    return { lines, stream };
  };

  it("never contain signatures, the session cookie or the secret", async () => {
    const { LOG_REDACT_PATHS } = await import("../app.js");
    const { lines, stream } = capture();
    const logged = buildApp({
      config,
      logger: { level: "trace", stream, redact: LOG_REDACT_PATHS },
      now,
    });
    await logged.ready();
    const wallet = newWallet();
    const { message } = (await logged.inject({ method: "POST", url: "/auth/nonce", payload: {} })).json();
    const filled = message.replace("<wallet address>", wallet.address);
    const signature = await wallet.signMessage({ message: filled });

    const bad = await newWallet().signMessage({ message: filled });
    await logged.inject({ method: "POST", url: "/auth/verify-wallet", payload: { message: filled, signature: bad } });
    const ok = await logged.inject({
      method: "POST",
      url: "/auth/verify-wallet",
      headers: { authorization: "Bearer test-authorization-value" },
      payload: { message: filled, signature },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    await logged.inject({ method: "GET", url: "/auth/me", cookies: { [SESSION_COOKIE]: cookie } });
    await logged.close();

    const output = lines.join("");
    expect(output).toContain("/auth/verify-wallet");
    for (const secret of [signature, bad, cookie, SECRET, "test-authorization-value"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("redact cookie and authorization headers if a log ever includes them", async () => {
    const { LOG_REDACT_PATHS } = await import("../app.js");
    const { lines, stream } = capture();
    const logged = buildApp({ config, logger: { stream, redact: LOG_REDACT_PATHS }, now });
    logged.log.info({ headers: { cookie: "test-cookie-value", authorization: "test-auth-value" } }, "probe");
    logged.log.info({ signature: "test-signature-value" }, "probe");
    await logged.close();
    const output = lines.join("");
    expect(output).toContain("[Redacted]");
    for (const secret of ["test-cookie-value", "test-auth-value", "test-signature-value"]) {
      expect(output).not.toContain(secret);
    }
  });
});
