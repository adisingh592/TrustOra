import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await import("./server.js"));
});

afterAll(() => app?.close());

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("serves the test UI HTML at root /", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("TRUSTORA");
    expect(res.body).toContain("Sign in with your wallet");
  });
});

describe("production startup validation", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // server.ts calls validateProductionEnv() before buildApp(), unconditionally
  // (unlike app.listen(), which it skips under NODE_ENV=test). This proves that
  // call is really wired into the boot path, not just unit-tested on its own.
  //
  // process.exit is typed "never": real code after it is unreachable, because the
  // real process truly halts there. The mock must honour that (throw, not return),
  // or it tests a situation that can never happen in production.
  //
  // SESSION_SECRET is also missing here so this throws even if validateProductionEnv
  // were never called (loadAuthConfig has its own, independent check for it). That
  // makes the test safe either way, but it would then also make a generic assertion
  // on "Refusing to start in production" pass for the wrong reason: loadAuthConfig's
  // own error contains that phrase too. So the assertion below checks for WEB_ORIGIN
  // by name — nothing but validateProductionEnv knows that variable exists.
  it("refuses to boot in production with an incomplete environment", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    delete process.env.WEB_ORIGIN;

    class ProcessExitCalled extends Error {
      constructor(readonly code: number) {
        super(`process.exit(${code})`);
      }
    }
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new ProcessExitCalled(code ?? 0);
      }) as never);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.resetModules();
    const failure = await import("./server.js").then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProcessExitCalled);
    expect((failure as InstanceType<typeof ProcessExitCalled>).code).toBe(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("WEB_ORIGIN"));

    exit.mockRestore();
    errorLog.mockRestore();
    vi.resetModules();
  });
});
