import type { AgentPaymentRequest } from "@trustora/shared";

export interface WalletAuthVerifier {
  createNonce(ctx: {
    domain: string;
    chainId: number;
  }): Promise<{ nonce: string; message: string; expiresAt: string }>;
  verify(
    message: string,
    signature: string,
  ): Promise<{ address: string; chainId: number }>;
}

export interface UploadPolicy {
  maxBytes: number;
  allowedExtensions: string[];
  maxZipEntries: number;
  maxZipUncompressedBytes: number;
  maxZipRatio: number;
}

export interface UploadValidator {
  validate(
    file: { name: string; claimedMime: string; bytes: Uint8Array },
    policy: UploadPolicy,
  ): Promise<
    | { ok: true; sha256: string; detectedType: string; size: number }
    | { ok: false; reason: string }
  >;
}

/** M5-DEFINED placeholder: the contract names PolicyState but gives no fields. */
export type PolicyState = Record<string, unknown>;

/** STRETCH: types only, no implementation yet. */
export interface AgentPolicyEngine {
  evaluate(
    req: AgentPaymentRequest,
    state: PolicyState,
  ): { allowed: boolean; ruleIds: string[]; reasons: string[] };
}
