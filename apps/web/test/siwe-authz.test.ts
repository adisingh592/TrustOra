import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  AuthMessageError,
  buildAgreementMessage,
  buildLoginMessage,
  parseLoginMessage,
  verifyAgreementSignature,
  verifyLoginSignature,
  type LoginMessageFields,
} from "../src/lib/siwe";
import { ACTION_ROLES, canPerform, isParticipant, rolesOf } from "../src/lib/authz";

// Ephemeral test-only keys; never real credentials.
const alice = privateKeyToAccount(generatePrivateKey());
const mallory = privateKeyToAccount(generatePrivateKey());

const NOW = new Date("2026-11-06T12:00:00.000Z");
const DOMAIN = "trustora.example";
const NONCE = "0123456789abcdef0123456789abcdef";

function fields(over: Partial<LoginMessageFields> = {}): LoginMessageFields {
  return {
    domain: DOMAIN,
    address: alice.address,
    uri: `https://${DOMAIN}`,
    chainId: 5042002,
    nonce: NONCE,
    issuedAt: NOW.toISOString(),
    expirationTime: new Date(NOW.getTime() + 600_000).toISOString(),
    ...over,
  };
}
const verify = (message: string, signature: string, over: Partial<{ domain: string; chain: number; now: Date }> = {}) =>
  verifyLoginSignature({ message, signature, expectedDomain: over.domain ?? DOMAIN, expectedChainId: over.chain ?? 5042002, now: over.now ?? NOW });

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AuthMessageError && e.code === code, `expected ${code}`);
}

test("login message round-trips through the strict parser", () => {
  const f = fields();
  assert.deepEqual(parseLoginMessage(buildLoginMessage(f)), f);
});

test("a valid wallet signature authenticates exactly that wallet", async () => {
  const message = buildLoginMessage(fields());
  const signature = await alice.signMessage({ message });
  const r = await verify(message, signature);
  assert.equal(r.address, alice.address);
  assert.equal(r.nonce, NONCE);
});

test("rejects a signature made by a different wallet than the one in the message", async () => {
  const message = buildLoginMessage(fields());
  await rejectsWith(verify(message, await mallory.signMessage({ message })), "ADDRESS_MISMATCH");
});

test("rejects tampered messages and garbage signatures", async () => {
  const message = buildLoginMessage(fields());
  const signature = await alice.signMessage({ message });
  await rejectsWith(verify(message.replace(NONCE, "f".repeat(32)), signature), "ADDRESS_MISMATCH");
  await rejectsWith(verify(message, "0x1234"), "BAD_SIGNATURE");
  await rejectsWith(verify(message, "not-a-signature"), "BAD_SIGNATURE");
});

test("rejects a message issued for another domain or chain (phishing / cross-chain replay)", async () => {
  const evil = buildLoginMessage(fields({ domain: "evil.example" }));
  await rejectsWith(verify(evil, await alice.signMessage({ message: evil })), "DOMAIN_MISMATCH");
  const otherChain = buildLoginMessage(fields({ chainId: 1 }));
  await rejectsWith(verify(otherChain, await alice.signMessage({ message: otherChain })), "CHAIN_MISMATCH");
});

test("rejects expired and future-dated messages", async () => {
  const message = buildLoginMessage(fields());
  const signature = await alice.signMessage({ message });
  await rejectsWith(verify(message, signature, { now: new Date(NOW.getTime() + 11 * 60_000) }), "MESSAGE_EXPIRED");
  await rejectsWith(verify(message, signature, { now: new Date(NOW.getTime() - 5 * 60_000) }), "MESSAGE_NOT_YET_VALID");
});

test("rejects malformed messages", async () => {
  for (const bad of ["", "hello", buildLoginMessage(fields()) + "\nExtra: 1", buildLoginMessage(fields()).replace("Version: 1", "Version: 2"), "x".repeat(2000)]) {
    await rejectsWith(verify(bad, "0x00"), "MALFORMED_MESSAGE");
  }
});

test("agreement acceptance signature binds to project, version, criteria hash and role", async () => {
  const p = { projectId: "TRU-PROJ-2026-0001042", versionNumber: 1, criteriaHash: "ab".repeat(32), role: "FREELANCER" as const };
  const message = buildAgreementMessage(p);
  const signature = await alice.signMessage({ message });
  assert.equal(await verifyAgreementSignature({ message, signature, expectedAddress: alice.address }), true);
  assert.equal(await verifyAgreementSignature({ message, signature, expectedAddress: mallory.address }), false);
  const changed = buildAgreementMessage({ ...p, criteriaHash: "cd".repeat(32) });
  assert.equal(await verifyAgreementSignature({ message: changed, signature, expectedAddress: alice.address }), false);
  assert.equal(await verifyAgreementSignature({ message, signature: "0xdead", expectedAddress: alice.address }), false);
});

// ---- authorization policy ----

const project = {
  clientAddress: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
  freelancerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  arbiterAddress: null as string | null,
};
const CLIENT = project.clientAddress.toLowerCase();
const FREELANCER = project.freelancerAddress;
const STRANGER = "0xcccccccccccccccccccccccccccccccccccccccc";

test("roles are derived from the wallet and project, case-insensitively", () => {
  assert.deepEqual(rolesOf(CLIENT, project), ["client"]);
  assert.deepEqual(rolesOf(FREELANCER.toUpperCase().replace("0X", "0x"), project), ["freelancer"]);
  assert.deepEqual(rolesOf(STRANGER, project), []);
  assert.equal(isParticipant(STRANGER, project), false);
  assert.deepEqual(rolesOf(CLIENT, { ...project, freelancerAddress: null }), ["client"]);
});

test("escrow action permissions: client funds/releases, freelancer submits/refunds, AI/strangers do nothing", () => {
  for (const a of ["fund", "release", "revision"] as const) {
    assert.equal(canPerform(CLIENT, project, ACTION_ROLES[a]), true, a);
    assert.equal(canPerform(FREELANCER, project, ACTION_ROLES[a]), false, a);
    assert.equal(canPerform(STRANGER, project, ACTION_ROLES[a]), false, a);
  }
  for (const a of ["submit", "refund"] as const) {
    assert.equal(canPerform(FREELANCER, project, ACTION_ROLES[a]), true, a);
    assert.equal(canPerform(CLIENT, project, ACTION_ROLES[a]), false, a);
  }
  assert.equal(canPerform(CLIENT, project, ACTION_ROLES.dispute), true);
  assert.equal(canPerform(FREELANCER, project, ACTION_ROLES.dispute), true);
  assert.equal(canPerform(STRANGER, project, ACTION_ROLES.dispute), false);
  assert.equal(canPerform(STRANGER, project, ACTION_ROLES.resolve), false);
});

test("a project with no freelancer assigned grants nothing to the zero/empty address", () => {
  const open = { ...project, freelancerAddress: null };
  assert.equal(canPerform("0x0000000000000000000000000000000000000000", open, ACTION_ROLES.submit), false);
});
