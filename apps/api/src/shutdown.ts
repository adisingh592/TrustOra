import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

export interface ShutdownDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  /** Defaults to process.exit. Overridable so tests never actually exit. */
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
}

/**
 * Stops accepting new connections, lets in-flight requests finish (app.close()
 * waits for them), closes the database, then exits 0. Installed only around the
 * one real server process: never call this from code that builds an app for tests,
 * or every test would add its own process-level signal listener.
 */
export const installGracefulShutdown = (deps: ShutdownDeps): (() => Promise<void>) => {
  const { app, prisma, exit = process.exit, signals = ["SIGTERM", "SIGINT"] } = deps;
  let shuttingDown: Promise<void> | null = null;
  let exited = false;

  const shutdown = async (): Promise<void> => {
    shuttingDown ??= (async () => {
      try {
        await app.close();
      } finally {
        await prisma.$disconnect();
      }
    })();

    try {
      await shuttingDown;
      if (!exited) {
        exited = true;
        exit(0);
      }
    } catch (error) {
      if (!exited) {
        exited = true;
        app.log.error(error, "error during shutdown");
        exit(1);
      }
    }
  };

  for (const signal of signals) process.once(signal, shutdown);
  return shutdown;
};
