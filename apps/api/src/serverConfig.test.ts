import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "./serverConfig.js";

// Every value here is a fixture; none is a real secret or address.
const VALID = {
  NODE_ENV: "production",
  SESSION_SECRET: "x".repeat(32),
  AUTH_DOMAIN: "app.example.invalid",
  DATABASE_URL: "file:/data/trustora.db",
  WEB_ORIGIN: "https://app.example.invalid",
  ARC_TESTNET_USDC_ADDRESS: `0x${"1".repeat(40)}`,
};

describe("validateProductionEnv", () => {
  it("does nothing outside production, however broken the env is", () => {
    for (const nodeEnv of [undefined, "", "development", "test"]) {
      expect(() => validateProductionEnv({ NODE_ENV: nodeEnv })).not.toThrow();
    }
  });

  it("passes with every required variable set correctly", () => {
    expect(() => validateProductionEnv(VALID)).not.toThrow();
  });

  it.each([
    ["missing SESSION_SECRET", { SESSION_SECRET: undefined }],
    ["short SESSION_SECRET", { SESSION_SECRET: "x".repeat(31) }],
    ["missing AUTH_DOMAIN", { AUTH_DOMAIN: undefined }],
    ["empty AUTH_DOMAIN", { AUTH_DOMAIN: "" }],
    ["missing DATABASE_URL", { DATABASE_URL: undefined }],
    ["missing WEB_ORIGIN", { WEB_ORIGIN: undefined }],
    ["missing ARC_TESTNET_USDC_ADDRESS", { ARC_TESTNET_USDC_ADDRESS: undefined }],
    ["malformed ARC_TESTNET_USDC_ADDRESS", { ARC_TESTNET_USDC_ADDRESS: "not-an-address" }],
    ["short ARC_TESTNET_USDC_ADDRESS", { ARC_TESTNET_USDC_ADDRESS: "0x1234" }],
  ])("refuses to start in production: %s", (_label, change) => {
    expect(() => validateProductionEnv({ ...VALID, ...change })).toThrow(/Refusing to start in production/);
  });

  it("names every missing field in one error, not just the first", () => {
    const error = (() => {
      try {
        validateProductionEnv({ NODE_ENV: "production" });
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected a throw");
    })();
    for (const field of ["SESSION_SECRET", "AUTH_DOMAIN", "DATABASE_URL", "WEB_ORIGIN", "ARC_TESTNET_USDC_ADDRESS"]) {
      expect(error.message).toContain(field);
    }
  });

  it("never includes the secret's own value in the error message", () => {
    const secretValue = "super-secret-value-that-is-31-chars";
    try {
      validateProductionEnv({ ...VALID, SESSION_SECRET: secretValue });
      throw new Error("expected a throw");
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
    }
  });
});

describe("validateStartupConfig & loadAdapters", () => {
  it("defaults to mock chain adapter and heuristic evaluation adapter", async () => {
    const { validateStartupConfig } = await import("./serverConfig.js");
    const { loadAdapters } = await import("./adapters/loader.js");

    const parsed = validateStartupConfig({});
    expect(parsed.CHAIN_ADAPTER).toBe("mock");
    expect(parsed.EVALUATION_ADAPTER).toBe("heuristic");

    const loaded = await loadAdapters({});
    expect(loaded.chainMode).toBe("mock");
    expect(loaded.evaluationMode).toBe("heuristic");
    expect(loaded.chainAdapter.getConfig().chainId).toBe(5042002);
  });

  it("refuses to start when CHAIN_ADAPTER=arc has missing environment variables", async () => {
    const { validateStartupConfig } = await import("./serverConfig.js");
    const { loadAdapters } = await import("./adapters/loader.js");

    expect(() => validateStartupConfig({ CHAIN_ADAPTER: "arc" })).toThrow(
      /ARC_ESCROW_CONTRACT_ADDRESS/,
    );

    await expect(loadAdapters({ CHAIN_ADAPTER: "arc" })).rejects.toThrow(
      /Refusing to start with CHAIN_ADAPTER=arc/,
    );
  });

  it("refuses to start when EVALUATION_ADAPTER=zerog has missing environment variables", async () => {
    const { validateStartupConfig } = await import("./serverConfig.js");
    const { loadAdapters } = await import("./adapters/loader.js");

    expect(() => validateStartupConfig({ EVALUATION_ADAPTER: "zerog" })).toThrow(
      /ZG_RPC_URL/,
    );

    await expect(loadAdapters({ EVALUATION_ADAPTER: "zerog" })).rejects.toThrow(
      /Refusing to start with EVALUATION_ADAPTER=zerog/,
    );
  });
});
