import { describe, expect, it } from "vitest";
import { buildCorsOptions, parseWebOrigins } from "./cors.js";

describe("parseWebOrigins", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["  ,  ,", []],
    ["https://a.test", ["https://a.test"]],
    ["https://a.test,https://b.test", ["https://a.test", "https://b.test"]],
    [" https://a.test , https://b.test ", ["https://a.test", "https://b.test"]],
    ["https://a.test,,https://b.test", ["https://a.test", "https://b.test"]],
  ])("parses %j as %j", (input, expected) => {
    expect(parseWebOrigins(input)).toEqual(expected);
  });
});

describe("buildCorsOptions", () => {
  const allow = (origins: string[], requestOrigin: string | undefined) =>
    new Promise<boolean>((resolve, reject) => {
      const options = buildCorsOptions(origins);
      (options.origin as (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void)(
        requestOrigin,
        (err, allowed) => (err ? reject(err) : resolve(Boolean(allowed))),
      );
    });

  it("always allows a request with no Origin header (curl, server-to-server)", async () => {
    expect(await allow([], undefined)).toBe(true);
    expect(await allow(["https://a.test"], undefined)).toBe(true);
  });

  it("allows an origin that is on the list", async () => {
    expect(await allow(["https://a.test", "https://b.test"], "https://b.test")).toBe(true);
  });

  it("refuses an origin that is not on the list, even with none configured", async () => {
    expect(await allow([], "https://evil.test")).toBe(false);
    expect(await allow(["https://a.test"], "https://evil.test")).toBe(false);
  });

  it("is case- and trailing-slash-sensitive: not a wildcard match", async () => {
    expect(await allow(["https://a.test"], "https://a.test/")).toBe(false);
    expect(await allow(["https://a.test"], "HTTPS://a.test")).toBe(false);
  });

  it("enables credentials, and the origin is never a literal wildcard", () => {
    const options = buildCorsOptions(["https://a.test"]);
    expect(options.credentials).toBe(true);
    expect(options.origin).not.toBe("*");
    expect(typeof options.origin).toBe("function");
  });

  it("refuses a wildcard origin string even if one somehow appears in WEB_ORIGIN", async () => {
    expect(await allow(["*"], "https://evil.test")).toBe(false);
  });
});
