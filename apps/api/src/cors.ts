import type { FastifyCorsOptions } from "@fastify/cors";

/** Comma-separated, trimmed, with empty entries dropped. */
export const parseWebOrigins = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

/**
 * Only the configured origins may use the cookie-bearing API from a browser.
 * With no origins configured, cross-origin requests are refused outright: never a
 * wildcard, with or without credentials, and never "allow everything" by default.
 * A request with no Origin header (curl, server-to-server, same-origin) is not a
 * CORS request at all, so it is never checked against this list.
 */
export const buildCorsOptions = (webOrigins: string[]): FastifyCorsOptions => ({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    callback(null, webOrigins.includes(origin));
  },
  credentials: true,
});
