import {
  ADDRESS_PLACEHOLDER,
  AuthError,
  createWalletAuthVerifier,
  withWalletAddress,
  type AuthErrorCode,
} from "@trustora/security";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

// Throwaway keys, generated per run and never stored. All sign-ins use a fake domain.
const DOMAIN = "trustora.test";
const CHAIN_ID = 5042002;
const newWallet = () => privateKeyToAccount(generatePrivateKey());

const expectAuthError = async (attempt: Promise<unknown>, code: AuthErrorCode) => {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
};

const setup = () => {
  let current = new Date("2026-11-06T00:00:00.000Z");
  const verifier = createWalletAuthVerifier({ domain: DOMAIN, now: () => current });
  return {
    verifier,
    advanceMs: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
};

const signIn = async (verifier: ReturnType<typeof setup>["verifier"]) => {
  const wallet = newWallet();
  const { message } = await verifier.createNonce({
    domain: DOMAIN,
    chainId: CHAIN_ID,
    address: wallet.address,
  });
  return { wallet, message, signature: await wallet.signMessage({ message }) };
};

describe("createNonce", () => {
  it("creates a readable message with every required field and at least 16 random bytes", async () => {
    const { verifier } = setup();
    const wallet = newWallet();
    const { nonce, message, expiresAt } = await verifier.createNonce({
      domain: DOMAIN,
      chainId: CHAIN_ID,
      address: wallet.address,
    });
    expect(nonce).toMatch(/^[0-9a-f]{32,}$/);
    expect(message.split("\n")).toEqual([
      `${DOMAIN} wants you to sign in with your Ethereum account:`,
      wallet.address,
      "",
      "Sign in to TRUSTORA",
      "",
      `URI: https://${DOMAIN}`,
      "Version: 1",
      "Chain ID: 5042002",
      `Nonce: ${nonce}`,
      "Issued At: 2026-11-06T00:00:00.000Z",
      "Expiration Time: 2026-11-06T00:05:00.000Z",
    ]);
    expect(expiresAt).toBe("2026-11-06T00:05:00.000Z");
  });

  it("never repeats a nonce", async () => {
    const { verifier } = setup();
    const ctx = { domain: DOMAIN, chainId: CHAIN_ID };
    const nonces = await Promise.all(
      Array.from({ length: 50 }, () => verifier.createNonce(ctx).then((n) => n.nonce)),
    );
    expect(new Set(nonces).size).toBe(50);
  });

  it("refuses another domain, another chain and a malformed address", async () => {
    const { verifier } = setup();
    await expectAuthError(
      verifier.createNonce({ domain: "evil.test", chainId: CHAIN_ID }),
      "DOMAIN_MISMATCH",
    );
    await expectAuthError(verifier.createNonce({ domain: DOMAIN, chainId: 1 }), "CHAIN_MISMATCH");
    await expectAuthError(
      verifier.createNonce({ domain: DOMAIN, chainId: CHAIN_ID, address: "0x123" }),
      "MALFORMED_MESSAGE",
    );
  });
});

describe("verify: attacks", () => {
  it("rejects replay of the same nonce", async () => {
    const { verifier } = setup();
    const { message, signature } = await signIn(verifier);
    await verifier.verify(message, signature);
    await expectAuthError(verifier.verify(message, signature), "NONCE_USED");
  });

  it("rejects an expired nonce, including exactly at the expiry time", async () => {
    const { verifier, advanceMs } = setup();
    const { message, signature } = await signIn(verifier);
    advanceMs(5 * 60 * 1000);
    await expectAuthError(verifier.verify(message, signature), "NONCE_EXPIRED");
  });

  it("accepts a nonce just before it expires", async () => {
    const { verifier, advanceMs } = setup();
    const { message, signature } = await signIn(verifier);
    advanceMs(5 * 60 * 1000 - 1);
    await expect(verifier.verify(message, signature)).resolves.toBeDefined();
  });

  it("rejects an unknown nonce", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = message.replace(/Nonce: .*/, `Nonce: ${"ab".repeat(16)}`);
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "NONCE_UNKNOWN",
    );
  });

  it("rejects a wrong domain, even when correctly signed", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = message.replace(`${DOMAIN} wants`, "evil.test wants");
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "DOMAIN_MISMATCH",
    );
  });

  it("rejects a wrong URI, even when correctly signed", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = message.replace(`URI: https://${DOMAIN}`, "URI: https://evil.test");
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "DOMAIN_MISMATCH",
    );
  });

  it("rejects a wrong chainId, even when correctly signed", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = message.replace("Chain ID: 5042002", "Chain ID: 1");
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "CHAIN_MISMATCH",
    );
  });

  it("rejects a signature from a different wallet", async () => {
    const { verifier } = setup();
    const { message } = await signIn(verifier);
    await expectAuthError(
      verifier.verify(message, await newWallet().signMessage({ message })),
      "SIGNATURE_INVALID",
    );
  });

  it.each<[string, unknown]>([
    ["empty", ""],
    ["plain text", "please let me in"],
    ["a number", 42],
    ["null", null],
    ["an object", { domain: DOMAIN }],
    ["very long", "a".repeat(100_000)],
  ])("rejects a malformed message: %s", async (_label, message) => {
    const { verifier } = setup();
    const { signature } = await signIn(verifier);
    await expectAuthError(verifier.verify(message as string, signature), "MALFORMED_MESSAGE");
  });

  it.each<[string, (message: string) => string]>([
    ["extra line at the end", (m) => `${m}\nAdmin: true`],
    ["trailing newline", (m) => `${m}\n`],
    ["Windows line endings", (m) => m.replaceAll("\n", "\r\n")],
    ["wrong statement", (m) => m.replace("Sign in to TRUSTORA", "Transfer all funds")],
    ["wrong version", (m) => m.replace("Version: 1", "Version: 2")],
    ["short address", (m) => m.replace(/0x[0-9a-fA-F]{40}/, "0x1234")],
    ["impossible date", (m) => m.replace(/Issued At: .*/, "Issued At: 2026-13-45T00:00:00.000Z")],
    ["non-canonical date", (m) => m.replace(/Issued At: .*/, "Issued At: 2026-11-06")],
    ["issued after it expires", (m) => m.replace(/Issued At: .*/, "Issued At: 2030-01-01T00:00:00.000Z")],
  ])("rejects a malformed message: %s", async (_label, change) => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = change(message);
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "MALFORMED_MESSAGE",
    );
  });

  it("rejects a message with a bad address checksum", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const flipped = wallet.address.replace(/[a-fA-F]/, (c) =>
      c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
    );
    const forged = message.replace(wallet.address, flipped);
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "MALFORMED_MESSAGE",
    );
  });

  it.each<[string, unknown]>([
    ["empty", ""],
    ["not hex", "not-a-signature"],
    ["too short", "0x1234"],
    ["no 0x prefix", "ab".repeat(65)],
    ["a number", 42],
    ["null", null],
  ])("rejects a malformed signature: %s", async (_label, signature) => {
    const { verifier } = setup();
    const { message } = await signIn(verifier);
    await expectAuthError(verifier.verify(message, signature as string), "MALFORMED_SIGNATURE");
  });

  it.each([
    ["all ff", `0x${"ff".repeat(65)}`],
    ["all zeros", `0x${"00".repeat(65)}`],
  ])("rejects a right-length signature that cannot recover: %s", async (_label, signature) => {
    const { verifier } = setup();
    const { message } = await signIn(verifier);
    await expectAuthError(verifier.verify(message, signature), "SIGNATURE_INVALID");
  });

  it("rejects a message tampered with after signing (one character)", async () => {
    const { verifier } = setup();
    const { message, signature } = await signIn(verifier);
    const tampered = message.replace("Issued At: 2026-11-06T00:00:00.000Z", "Issued At: 2026-11-06T00:00:01.000Z");
    expect(tampered).not.toBe(message);
    await expectAuthError(verifier.verify(tampered, signature), "SIGNATURE_INVALID");
  });

  it("rejects a message with the expiry extended, even when correctly signed", async () => {
    const { verifier } = setup();
    const { wallet, message } = await signIn(verifier);
    const forged = message.replace(/Expiration Time: .*/, "Expiration Time: 2030-01-01T00:00:00.000Z");
    await expectAuthError(
      verifier.verify(forged, await wallet.signMessage({ message: forged })),
      "NONCE_MISMATCH",
    );
  });

  it("rejects a nonce issued for address A when used by address B", async () => {
    const { verifier } = setup();
    const { wallet: a, message } = await signIn(verifier);
    const b = newWallet();
    const forged = message.replace(a.address, b.address);
    await expectAuthError(
      verifier.verify(forged, await b.signMessage({ message: forged })),
      "ADDRESS_MISMATCH",
    );
  });

  it("lets exactly one of two parallel verifies succeed", async () => {
    const { verifier } = setup();
    const { message, signature } = await signIn(verifier);
    const results = await Promise.allSettled([
      verifier.verify(message, signature),
      verifier.verify(message, signature),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(AuthError);
    expect((failed as PromiseRejectedResult).reason.code).toBe("NONCE_USED");
  });

  it("lets exactly one of many parallel verifies succeed", async () => {
    const { verifier } = setup();
    const { message, signature } = await signIn(verifier);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => verifier.verify(message, signature)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("does not let a stranger's bad signature burn the nonce", async () => {
    const { verifier } = setup();
    const { message, signature } = await signIn(verifier);
    await expectAuthError(
      verifier.verify(message, await newWallet().signMessage({ message })),
      "SIGNATURE_INVALID",
    );
    await expect(verifier.verify(message, signature)).resolves.toBeDefined();
  });

  it("does not verify the unfilled address placeholder", async () => {
    const { verifier } = setup();
    const wallet = newWallet();
    const { message } = await verifier.createNonce({ domain: DOMAIN, chainId: CHAIN_ID });
    expect(message).toContain(ADDRESS_PLACEHOLDER);
    await expectAuthError(
      verifier.verify(message, await wallet.signMessage({ message })),
      "MALFORMED_MESSAGE",
    );
  });
});

describe("verify: success", () => {
  it("returns the lowercase address for a checksum-case message", async () => {
    const { verifier } = setup();
    const { wallet, message, signature } = await signIn(verifier);
    expect(wallet.address).not.toBe(wallet.address.toLowerCase());
    await expect(verifier.verify(message, signature)).resolves.toEqual({
      address: wallet.address.toLowerCase(),
      chainId: CHAIN_ID,
    });
  });

  it("works when the address is only known after the wallet connects", async () => {
    const { verifier } = setup();
    const wallet = newWallet();
    const created = await verifier.createNonce({ domain: DOMAIN, chainId: CHAIN_ID });
    const message = withWalletAddress(created.message, wallet.address);
    await expect(
      verifier.verify(message, await wallet.signMessage({ message })),
    ).resolves.toEqual({ address: wallet.address.toLowerCase(), chainId: CHAIN_ID });
  });
});
