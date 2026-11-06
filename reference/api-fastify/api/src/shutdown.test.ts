import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "./shutdown.js";

// A fake signal name so this never collides with the real process's own SIGTERM/SIGINT.
const FAKE_SIGNAL = "SIGUSR2" as const;

afterEach(() => {
  process.removeAllListeners(FAKE_SIGNAL);
});

interface FakeApp { close: () => Promise<void>; log: { error: (...args: unknown[]) => void } }
const fakeApp = (over: Partial<FakeApp> = {}): FastifyInstance =>
  ({ close: vi.fn(async () => undefined), log: { error: vi.fn() }, ...over }) as unknown as FastifyInstance;
const fakePrisma = (over: Partial<PrismaClient> = {}) =>
  ({ $disconnect: vi.fn(async () => undefined), ...over }) as unknown as PrismaClient;

describe("installGracefulShutdown", () => {
  it("closes the app, then disconnects Prisma, then exits 0", async () => {
    const order: string[] = [];
    const app = fakeApp({ close: vi.fn(async () => void order.push("app.close")) });
    const prisma = fakePrisma({ $disconnect: vi.fn(async () => void order.push("prisma.$disconnect")) });
    const exit = vi.fn();

    const shutdown = installGracefulShutdown({ app, prisma, exit, signals: [FAKE_SIGNAL] });
    await shutdown();

    expect(order).toEqual(["app.close", "prisma.$disconnect"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("disconnects Prisma even if app.close() throws, and exits 1", async () => {
    const app = fakeApp({ close: vi.fn(async () => { throw new Error("close failed"); }) });
    const disconnect = vi.fn(async () => undefined);
    const prisma = fakePrisma({ $disconnect: disconnect });
    const exit = vi.fn();

    await installGracefulShutdown({ app, prisma, exit, signals: [FAKE_SIGNAL] })();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a second call while shutting down does not close or disconnect twice", async () => {
    const app = fakeApp();
    const prisma = fakePrisma();
    const exit = vi.fn();
    const shutdown = installGracefulShutdown({ app, prisma, exit, signals: [FAKE_SIGNAL] });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("registers a listener for every given signal, each firing the same shutdown", async () => {
    const app = fakeApp();
    const prisma = fakePrisma();
    const exit = vi.fn();
    installGracefulShutdown({ app, prisma, exit, signals: [FAKE_SIGNAL] });

    expect(process.listenerCount(FAKE_SIGNAL)).toBe(1);
    process.emit(FAKE_SIGNAL);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("defaults to real process.exit and SIGTERM/SIGINT when not overridden", () => {
    const app = fakeApp();
    const prisma = fakePrisma();
    const before = { TERM: process.listenerCount("SIGTERM"), INT: process.listenerCount("SIGINT") };
    installGracefulShutdown({ app, prisma });
    expect(process.listenerCount("SIGTERM")).toBe(before.TERM + 1);
    expect(process.listenerCount("SIGINT")).toBe(before.INT + 1);
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });
});
