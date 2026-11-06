/**
 * @file agent.ts
 * @description Bounded autonomous AI agent payment coordinator for x402 services.
 */

import { AgentPaymentResult, AuditLogEntry, HederaPaymentPolicy, X402Challenge } from "./types";
import { AgentPolicyEngine } from "./policy";
import { HederaSettlementVerifier } from "./verifier";
import { formatTinybars, parseHbarToTinybars } from "./units";

export interface HederaAgentConfig {
  accountId?: string;
  privateKey?: string;
  policy?: Partial<HederaPaymentPolicy>;
  mirrorNodeUrl?: string;
  spendLedger?: {
    reserve: (amountTinybars: bigint, idempotencyKey: string) => Promise<{ allowed: boolean; reason?: string }>;
  };
}

export class HederaAgentPayer {
  private policyEngine: AgentPolicyEngine;
  private verifier: HederaSettlementVerifier;
  private accountId: string | null;
  private privateKey: string | null;
  private readonly spendLedger: HederaAgentConfig["spendLedger"];

  constructor(config: HederaAgentConfig = {}) {
    this.policyEngine = new AgentPolicyEngine(config.policy);
    this.verifier = new HederaSettlementVerifier({ mirrorUrl: config.mirrorNodeUrl });
    this.accountId = config.accountId || process.env.HEDERA_ACCOUNT_ID || null;
    this.privateKey = config.privateKey || process.env.HEDERA_PRIVATE_KEY || null;
    this.spendLedger = config.spendLedger;
  }

  /**
   * Parses standard x402 challenge header or body payload.
   * Example: x402 scheme="exact", network="hedera:testnet", asset="0.0.0", recipient="0.0.482910", amount="1.5", resource="sec-audit-01"
   */
  public parseX402Header(headerValue: string): X402Challenge | null {
    if (!headerValue || !headerValue.startsWith("x402")) {
      return null;
    }

    const params: Record<string, string> = {};
    const regex = /(\w+)="?([^",]+)"?/g;
    let match;
    while ((match = regex.exec(headerValue)) !== null) {
      params[match[1]] = match[2];
    }

    if (!params.network || !params.recipient || !params.amount) {
      return null;
    }

    return {
      scheme: params.scheme || "exact",
      network: params.network,
      asset: params.asset || "0.0.0",
      recipient: params.recipient,
      amountHbar: Number.isFinite(Number(params.amount)) ? Number(params.amount) : params.amount,
      amountTinybars: (() => {
        try { return parseHbarToTinybars(params.amount); } catch { return undefined; }
      })(),
      resourceId: params.resource || "unspecified",
      facilitatorUrl: params.facilitator,
    };
  }

  /**
   * Executes a bounded autonomous payment for a specialized agent sub-task under policy control.
   */
  public async executeAutonomousPayment(
    challenge: X402Challenge,
    providerHost: string
  ): Promise<AgentPaymentResult> {
    const auditLog: AuditLogEntry[] = [];
    const timestamp = new Date().toISOString();

    auditLog.push({
      step: "RECEIVED_X402_CHALLENGE",
      timestamp,
      details: {
        scheme: challenge.scheme,
        network: challenge.network,
        asset: challenge.asset,
        recipient: challenge.recipient,
        amountHbar: challenge.amountHbar,
        resourceId: challenge.resourceId,
        providerHost,
      },
    });

    // 1. Policy enforcement check
    const policyResult = this.policyEngine.evaluateChallenge(challenge, providerHost);
    auditLog.push({
      step: "POLICY_EVALUATION",
      timestamp: new Date().toISOString(),
      details: {
        allowed: policyResult.allowed,
        reason: policyResult.reason || "POLICY_APPROVED",
      },
    });

    if (!policyResult.allowed) {
      return {
        status: "REJECTED_POLICY",
        txId: null,
        amountHbar: challenge.amountHbar,
        recipient: challenge.recipient,
        timestamp,
        hashscanUrl: null,
        rejectionReason: policyResult.reason,
        auditLog,
      };
    }

    const amountTinybars = challenge.amountTinybars ?? (() => {
      try { return parseHbarToTinybars(String(challenge.amountHbar)); } catch { return 0n; }
    })();
    if (amountTinybars <= 0n) {
      return {
        status: "REJECTED_POLICY",
        txId: null,
        amountHbar: challenge.amountHbar,
        amountTinybars: "0",
        recipient: challenge.recipient,
        timestamp,
        hashscanUrl: null,
        rejectionReason: "INVALID_HBAR_AMOUNT",
        auditLog,
      };
    }

    // 2. Credential verification (never fabricate transactions)
    if (!this.accountId || !this.privateKey) {
      auditLog.push({
        step: "WALLET_CONFIGURATION_CHECK",
        timestamp: new Date().toISOString(),
        details: {
          status: "NOT_CONFIGURED",
          message: "Hedera agent keys (HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY) not configured in environment.",
        },
      });

      return {
        status: "NOT_CONFIGURED",
        txId: null,
        amountHbar: challenge.amountHbar,
        amountTinybars: amountTinybars.toString(),
        recipient: challenge.recipient,
        timestamp,
        hashscanUrl: null,
        rejectionReason: "HEDERA_KEYS_NOT_CONFIGURED",
        auditLog,
      };
    }

    if (!this.spendLedger) {
      auditLog.push({
        step: "PAYMENT_NOT_SUBMITTED",
        timestamp: new Date().toISOString(),
        details: { status: "NOT_CONFIGURED", message: "Persistent spend ledger is not configured." },
      });
      return {
        status: "NOT_CONFIGURED",
        txId: null,
        amountHbar: challenge.amountHbar,
        amountTinybars: amountTinybars.toString(),
        recipient: challenge.recipient,
        timestamp,
        hashscanUrl: null,
        rejectionReason: "PERSISTENT_SPEND_LEDGER_NOT_CONFIGURED",
        auditLog,
      };
    }

    // Credentials alone are not a payment integration. A real x402 v2 flow must
    // create a signed payload and receive a facilitator transaction ID, then verify
    // that ID against the Mirror Node. Never report a locally-generated ID as settled.
    auditLog.push({
      step: "PAYMENT_NOT_SUBMITTED",
      timestamp: new Date().toISOString(),
      details: {
        status: "NOT_CONFIGURED",
        message: "No x402 facilitator flow is configured; no Hedera transaction was submitted.",
      },
    });

    return {
      status: "NOT_CONFIGURED",
      txId: null,
      amountHbar: challenge.amountHbar,
      amountTinybars: amountTinybars.toString(),
      recipient: challenge.recipient,
      timestamp,
      hashscanUrl: null,
      rejectionReason: "X402_FACILITATOR_NOT_CONFIGURED",
      auditLog,
    };
  }

  public getPolicyEngine(): AgentPolicyEngine {
    return this.policyEngine;
  }

  public getVerifier(): HederaSettlementVerifier {
    return this.verifier;
  }
}
