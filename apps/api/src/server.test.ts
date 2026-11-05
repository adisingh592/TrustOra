import { afterAll, describe, expect, it } from "vitest";
import { app } from "./server.js";

afterAll(() => app.close());

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
