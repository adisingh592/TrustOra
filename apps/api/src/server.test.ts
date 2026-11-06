import { afterAll, describe, expect, it } from "vitest";
import { app } from "./server.js";

afterAll(() => app.close());

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
