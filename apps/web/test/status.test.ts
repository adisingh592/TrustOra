import { test } from "node:test";
import assert from "node:assert/strict";
import { getSystemStatus } from "../src/lib/status";

const ADDR = "0x" + "ab".repeat(20);

test("nothing configured: everything reports honestly unavailable", () => {
  const s = getSystemStatus({});
  assert.equal(s.arcEscrow.status, "NOT_CONFIGURED");
  assert.equal(s.zeroG.status, "NOT_CONFIGURED");
  assert.equal(s.hedera.status, "NOT_IMPLEMENTED");
});

test("escrow address is validated, not just present", () => {
  assert.equal(getSystemStatus({ ESCROW_CONTRACT_ADDRESS: ADDR }).arcEscrow.status, "CONFIGURED");
  assert.equal(getSystemStatus({ ESCROW_CONTRACT_ADDRESS: "0x123" }).arcEscrow.status, "BLOCKED");
  assert.equal(getSystemStatus({ ESCROW_CONTRACT_ADDRESS: "   " }).arcEscrow.status, "NOT_CONFIGURED");
});

test("0G: router key configures it; broker-only does not; a mainnet URL is blocked", () => {
  assert.equal(getSystemStatus({ ZG_ROUTER_API_KEY: "k" }).zeroG.status, "CONFIGURED");
  assert.equal(getSystemStatus({ ZG_PRIVATE_KEY: "pk" }).zeroG.status, "NOT_CONFIGURED");
  assert.equal(getSystemStatus({ ZG_ROUTER_API_KEY: "k", ZG_ROUTER_BASE_URL: "https://router-api.0g.ai/v1" }).zeroG.status, "BLOCKED");
});

test("status never echoes secrets, URLs or addresses from the environment", () => {
  const out = JSON.stringify(getSystemStatus({
    ESCROW_CONTRACT_ADDRESS: ADDR, ZG_ROUTER_API_KEY: "SECRET-KEY-123", ZG_PRIVATE_KEY: "SECRET-PK-456",
    ZG_ROUTER_BASE_URL: "https://custom.example/v1", HEDERA_PRIVATE_KEY: "SECRET-H",
  }));
  for (const secret of ["SECRET-KEY-123", "SECRET-PK-456", "SECRET-H", "custom.example", ADDR]) assert.ok(!out.includes(secret), secret);
});

test("Hedera is never reported as available", () => {
  assert.equal(getSystemStatus({ HEDERA_ACCOUNT_ID: "0.0.1", HEDERA_PRIVATE_KEY: "x" }).hedera.status, "NOT_IMPLEMENTED");
});
