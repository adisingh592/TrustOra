import { test } from "node:test";
import assert from "node:assert/strict";
import { walletProviderError } from "../src/lib/wallet-errors";

test("maps MetaMask provider errors to actionable messages", () => {
  assert.match(walletProviderError({ code: 4001 }), /cancelled/i);
  assert.match(walletProviderError({ code: 4100 }), /authorized/i);
  assert.match(walletProviderError({ code: 4900 }), /disconnected/i);
  assert.match(walletProviderError({ code: 4901 }), /Arc Testnet/i);
});
