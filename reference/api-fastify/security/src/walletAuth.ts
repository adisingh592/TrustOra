import { randomBytes } from "node:crypto";
import { ARC_TESTNET_CHAIN_ID } from "@trustora/shared";
import { isAddress, verifyMessage } from "viem";
import type { WalletAuthVerifier } from "./types.js";

// Sign-in with an EIP-4361-style message. Externally owned accounts only:
// smart-contract wallets (EIP-1271) are NOT supported.

const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1024;
const STATEMENT = "Sign in to TRUSTORA";

/** Stands in for the address until the wallet connects. It can never verify. */
export const ADDRESS_PLACEHOLDER = "<wallet address>";

export type AuthErrorCode =
  | "MALFORMED_MESSAGE"
  | "MALFORMED_SIGNATURE"
  | "DOMAIN_MISMATCH"
  | "CHAIN_MISMATCH"
  | "NONCE_UNKNOWN"
  | "NONCE_EXPIRED"
  | "NONCE_USED"
  | "NONCE_MISMATCH"
  | "ADDRESS_MISMATCH"
  | "SIGNATURE_INVALID";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface NonceRecord {
  nonce: string;
  domain: string;
  chainId: number;
  /** Lowercase. When set, only this address can use the nonce. */
  address?: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface NonceStore {
  save(record: NonceRecord): Promise<void>;
  get(nonce: string): Promise<NonceRecord | null>;
  /**
   * Atomic compare-and-set: mark the nonce used only if it exists, is unused
   * and has not expired. Returns true for exactly one caller. A database store
   * must do this in one statement, for example
   * updateMany({ where: { nonce, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
   * and return count === 1. Never read and then write.
   */
  consume(nonce: string, now: Date): Promise<boolean>;
}

export const createInMemoryNonceStore = (): NonceStore => {
  const records = new Map<string, NonceRecord>();
  return {
    async save(record) {
      for (const [nonce, { expiresAt }] of records) {
        if (expiresAt <= new Date()) records.delete(nonce);
      }
      records.set(record.nonce, { ...record });
    },
    async get(nonce) {
      const record = records.get(nonce);
      return record ? { ...record } : null;
    },
    // No await between the check and the write, so this cannot interleave.
    async consume(nonce, now) {
      const record = records.get(nonce);
      if (!record || record.usedAt || record.expiresAt <= now) return false;
      record.usedAt = now;
      return true;
    },
  };
};

export interface WalletAuthConfig {
  /** The only domain accepted, for example trustora.example. */
  domain: string;
  /** Defaults to https://<domain>. */
  uri?: string;
  /** Defaults to an in-memory store, which does not survive a restart. */
  store?: NonceStore;
  /** For tests. */
  now?: () => Date;
}

export interface WalletAuthService extends WalletAuthVerifier {
  createNonce(ctx: {
    domain: string;
    chainId: number;
    address?: string;
  }): Promise<{ nonce: string; message: string; expiresAt: string }>;
}

const MESSAGE_PATTERN = new RegExp(
  "^(\\S+) wants you to sign in with your Ethereum account:\\n" +
    "(0x[0-9a-fA-F]{40})\\n\\n" +
    `${STATEMENT}\\n\\n` +
    "URI: (\\S+)\\n" +
    "Version: 1\\n" +
    "Chain ID: ([0-9]{1,16})\\n" +
    "Nonce: ([0-9a-f]{32,})\\n" +
    "Issued At: (\\S+)\\n" +
    "Expiration Time: (\\S+)$",
);
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

const parseTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new AuthError("MALFORMED_MESSAGE", "The sign-in message has an invalid time.");
  }
  return date;
};

const parseMessage = (message: unknown) => {
  if (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH) {
    throw new AuthError("MALFORMED_MESSAGE", "The sign-in message is not valid.");
  }
  const match = MESSAGE_PATTERN.exec(message);
  if (!match) {
    throw new AuthError("MALFORMED_MESSAGE", "The sign-in message is not valid.");
  }
  const [, domain, address, uri, chainId, nonce, issuedAt, expirationTime] = match;
  if (!isAddress(address!, { strict: true })) {
    throw new AuthError("MALFORMED_MESSAGE", "The address in the sign-in message is not valid.");
  }
  const issued = parseTimestamp(issuedAt!);
  const expires = parseTimestamp(expirationTime!);
  if (issued > expires) {
    throw new AuthError("MALFORMED_MESSAGE", "The sign-in message has an invalid time.");
  }
  return {
    domain: domain!,
    address: address as `0x${string}`,
    uri: uri!,
    chainId: Number(chainId),
    nonce: nonce!,
    expirationTime: expirationTime!,
  };
};

const buildMessage = (fields: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) =>
  [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
    STATEMENT,
    "",
    `URI: ${fields.uri}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expiresAt}`,
  ].join("\n");

/** Puts the connected wallet's address into a message from createNonce. */
export const withWalletAddress = (message: string, address: string) =>
  message.replace(ADDRESS_PLACEHOLDER, () => address);

export const createWalletAuthVerifier = (config: WalletAuthConfig): WalletAuthService => {
  const store = config.store ?? createInMemoryNonceStore();
  const now = config.now ?? (() => new Date());
  const uri = config.uri ?? `https://${config.domain}`;

  return {
    async createNonce(ctx) {
      if (ctx.domain !== config.domain) {
        throw new AuthError("DOMAIN_MISMATCH", "This sign-in is for a different website.");
      }
      if (ctx.chainId !== ARC_TESTNET_CHAIN_ID) {
        throw new AuthError("CHAIN_MISMATCH", "Sign-in is only available on Arc Testnet.");
      }
      if (ctx.address !== undefined && !isAddress(ctx.address, { strict: true })) {
        throw new AuthError("MALFORMED_MESSAGE", "The wallet address is not valid.");
      }
      const nonce = randomBytes(16).toString("hex");
      const issued = now();
      const expires = new Date(issued.getTime() + NONCE_TTL_MS);
      await store.save({
        nonce,
        domain: config.domain,
        chainId: ARC_TESTNET_CHAIN_ID,
        ...(ctx.address ? { address: ctx.address.toLowerCase() } : {}),
        expiresAt: expires,
      });
      return {
        nonce,
        message: buildMessage({
          domain: config.domain,
          address: ctx.address ?? ADDRESS_PLACEHOLDER,
          uri,
          chainId: ARC_TESTNET_CHAIN_ID,
          nonce,
          issuedAt: issued.toISOString(),
          expiresAt: expires.toISOString(),
        }),
        expiresAt: expires.toISOString(),
      };
    },

    async verify(message, signature) {
      const parsed = parseMessage(message);
      if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
        throw new AuthError("MALFORMED_SIGNATURE", "The signature is not valid.");
      }
      if (parsed.domain !== config.domain || parsed.uri !== uri) {
        throw new AuthError("DOMAIN_MISMATCH", "This sign-in is for a different website.");
      }
      if (parsed.chainId !== ARC_TESTNET_CHAIN_ID) {
        throw new AuthError("CHAIN_MISMATCH", "Sign-in is only available on Arc Testnet.");
      }

      const record = await store.get(parsed.nonce);
      const current = now();
      if (!record) {
        throw new AuthError("NONCE_UNKNOWN", "This sign-in request was not found. Please try again.");
      }
      if (record.usedAt) {
        throw new AuthError("NONCE_USED", "This sign-in request was already used. Please try again.");
      }
      if (record.expiresAt <= current) {
        throw new AuthError("NONCE_EXPIRED", "This sign-in request has expired. Please try again.");
      }
      if (
        record.domain !== parsed.domain ||
        record.chainId !== parsed.chainId ||
        record.expiresAt.toISOString() !== parsed.expirationTime
      ) {
        throw new AuthError("NONCE_MISMATCH", "This sign-in request does not match. Please try again.");
      }
      const address = parsed.address.toLowerCase();
      if (record.address && record.address !== address) {
        throw new AuthError("ADDRESS_MISMATCH", "This sign-in request is for a different wallet.");
      }

      let signatureMatches = false;
      try {
        signatureMatches = await verifyMessage({
          address: parsed.address,
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        signatureMatches = false;
      }
      if (!signatureMatches) {
        throw new AuthError("SIGNATURE_INVALID", "The signature does not match this wallet.");
      }

      // Last, so a bad signature from a stranger cannot burn someone's nonce.
      if (!(await store.consume(parsed.nonce, current))) {
        throw new AuthError("NONCE_USED", "This sign-in request was already used. Please try again.");
      }
      return { address, chainId: parsed.chainId };
    },
  };
};
