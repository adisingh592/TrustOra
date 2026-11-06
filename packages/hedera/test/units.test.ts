import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAYMENT_TINYBARS,
  MAX_DAILY_TINYBARS,
  MAX_PAYMENT_TINYBARS,
  TINYBARS_PER_HBAR,
  formatTinybars,
  isHederaAccountId,
  parseHbarToTinybars,
  parseTinybarsAmount,
} from "../src/units";

test("approved amounts: 0.1 HBAR default, 1 HBAR per payment, 5 HBAR per day, in integer tinybars", () => {
  assert.equal(TINYBARS_PER_HBAR, 100_000_000n);
  assert.equal(DEFAULT_PAYMENT_TINYBARS, 10_000_000n);
  assert.equal(MAX_PAYMENT_TINYBARS, 100_000_000n);
  assert.equal(MAX_DAILY_TINYBARS, 500_000_000n);
  assert.ok(DEFAULT_PAYMENT_TINYBARS <= MAX_PAYMENT_TINYBARS && MAX_PAYMENT_TINYBARS <= MAX_DAILY_TINYBARS);
});

test("HBAR strings convert to tinybars exactly, with no float rounding", () => {
  assert.equal(parseHbarToTinybars("0.1"), 10_000_000n);
  assert.equal(parseHbarToTinybars("1"), 100_000_000n);
  assert.equal(parseHbarToTinybars("0.00000001"), 1n);
  assert.equal(parseHbarToTinybars("5.5"), 550_000_000n);
  // 0.1 + 0.2 is 0.30000000000000004 in floats; in tinybars it is exact.
  assert.equal(parseHbarToTinybars("0.1") + parseHbarToTinybars("0.2"), parseHbarToTinybars("0.3"));
  for (const bad of ["", "-1", "1.123456789", "abc", "1e8", "0x10", " ", "1,5"]) {
    assert.throws(() => parseHbarToTinybars(bad), /Invalid HBAR amount/, bad);
  }
});

test("tinybars format back to exact HBAR strings for display", () => {
  assert.equal(formatTinybars(10_000_000n), "0.1");
  assert.equal(formatTinybars(100_000_000n), "1");
  assert.equal(formatTinybars(1n), "0.00000001");
  assert.equal(formatTinybars(0n), "0");
  assert.equal(formatTinybars(-25_000_000n), "-0.25");
  for (const s of ["0.1", "1", "12.34567891", "0.00000001"]) assert.equal(formatTinybars(parseHbarToTinybars(s)), s);
});

test("x402 amount fields must be plain positive integer strings", () => {
  assert.equal(parseTinybarsAmount("10000000"), 10_000_000n);
  assert.equal(parseTinybarsAmount("1"), 1n);
  for (const bad of ["0", "-1", "01", "1.5", "1e7", " 1", "1 ", "", "abc", 10_000_000, null, undefined, "99999999999999999999"]) {
    assert.equal(parseTinybarsAmount(bad), null, String(bad));
  }
});

test("Hedera account IDs must be shard.realm.num", () => {
  for (const ok of ["0.0.1", "0.0.9185802", "1.2.3"]) assert.equal(isHederaAccountId(ok), true, ok);
  for (const bad of ["0.0", "0.0.x", "0x1234", "0.0.1.2", "", " 0.0.1", 1, null]) assert.equal(isHederaAccountId(bad), false, String(bad));
});
