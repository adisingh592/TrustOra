/**
 * @file policy.ts
 * @description Policy engine for bounded autonomous agent payments on Hedera.
 */

import { HederaPaymentPolicy, X402Challenge } from "./types";

export const DEFAULT_HEDERA_POLICY: HederaPaymentPolicy = {
  maxPaymentHbar: 5.0,        // Max 5 HBAR per request
  maxDailyBudgetHbar: 25.0,    // Max 25 HBAR per 24 hours
  allowedProviders: [
    "0.0.482910",              // Official Trustora Code Auditor Testnet Account
    "0.0.482911",              // Official Trustora Security Scanner Testnet Account
    "audit.trustora.network",
    "scan.trustora.network",
    "verify.integratenetwork.work"
  ],
  allowedNetworks: ["hedera:testnet"],
  allowedAssets: ["0.0.0"],   // Native HBAR
};

export class AgentPolicyEngine {
  private policy: HederaPaymentPolicy;
  private dailySpendTracker: Map<string, number> = new Map();

  constructor(customPolicy?: Partial<HederaPaymentPolicy>) {
    this.policy = { ...DEFAULT_HEDERA_POLICY, ...customPolicy };
  }

  /**
   * Evaluates an x402 payment challenge against security policies.
   */
  public evaluateChallenge(challenge: X402Challenge, providerHostOrAccount: string): {
    allowed: boolean;
    reason?: string;
  } {
    // 1. Network check
    if (!this.policy.allowedNetworks.includes(challenge.network)) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Network "${challenge.network}" not in allowed list [${this.policy.allowedNetworks.join(", ")}]`,
      };
    }

    // 2. Asset check
    if (!this.policy.allowedAssets.includes(challenge.asset)) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Asset "${challenge.asset}" is not native HBAR (0.0.0)`,
      };
    }

    // 3. Provider allowlist check
    const isRecipientAllowed = this.policy.allowedProviders.some(
      (p) => p.toLowerCase() === challenge.recipient.toLowerCase() ||
             p.toLowerCase() === providerHostOrAccount.toLowerCase()
    );
    if (!isRecipientAllowed) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Provider "${providerHostOrAccount}" / recipient "${challenge.recipient}" is not allowlisted`,
      };
    }

    // 4. Per-transaction amount cap
    if (challenge.amountHbar > this.policy.maxPaymentHbar) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Requested amount ${challenge.amountHbar} HBAR exceeds maximum per-transaction cap (${this.policy.maxPaymentHbar} HBAR)`,
      };
    }

    // 5. Daily budget ceiling
    const today = new Date().toISOString().slice(0, 10);
    const currentDailySpend = this.dailySpendTracker.get(today) || 0;
    if (currentDailySpend + challenge.amountHbar > this.policy.maxDailyBudgetHbar) {
      return {
        allowed: false,
        reason: `POLICY_VIOLATION: Requested payment would exceed daily budget ceiling (Current: ${currentDailySpend} HBAR, Cap: ${this.policy.maxDailyBudgetHbar} HBAR)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Records successful spend towards daily budget ceiling.
   */
  public recordSpend(amountHbar: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const currentDailySpend = this.dailySpendTracker.get(today) || 0;
    this.dailySpendTracker.set(today, currentDailySpend + amountHbar);
  }

  public getDailySpend(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.dailySpendTracker.get(today) || 0;
  }

  public getPolicy(): Readonly<HederaPaymentPolicy> {
    return this.policy;
  }
}

