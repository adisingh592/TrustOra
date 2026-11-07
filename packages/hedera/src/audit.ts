/**
 * @file audit.ts
 * @description Hedera Consensus Service (HCS) project activity recording and audit verification.
 *
 * In TRUSTORA, Hedera provides an optional blockchain-based record of critical project activities:
 *   1. Agreement Acceptance: Timestamps frozen acceptance criteria and participant signatures.
 *   2. Milestone Completion: Records deliverable hashes and client release authorizations.
 *   3. Project Activity Verification: Anchors 0G AI advisory evaluation reports and consensus states.
 *   4. Transaction & Audit References: Generates verifiable HashScan links backed by the Hedera Mirror Node.
 *
 * Primary evidence anchoring uses Arkiv and Arc escrow; Hedera provides optional enterprise auditability.
 */

import crypto from "node:crypto";
import { isHederaAccountId } from "./units";
import { hashScanTransactionUrl, toMirrorTransactionId, TESTNET_MIRROR_URL } from "./verifier";

export type HederaActivityType =
  | "AGREEMENT_ACCEPTED"
  | "MILESTONE_COMPLETED"
  | "ACTIVITY_VERIFIED"
  | "AUDIT_REFERENCE";

export interface HederaAuditRecordPayload {
  protocol: "TRUSTORA-HCS-v1";
  activityType: HederaActivityType;
  projectId: string;
  timestamp: string;
  payloadHash: string;
  details: Record<string, unknown>;
}

export interface HederaAuditRecordResult {
  recordId: string;
  activityType: HederaActivityType;
  projectId: string;
  payload: HederaAuditRecordPayload;
  payloadHash: string;
  topicId: string | null;
  transactionId: string | null;
  consensusTimestamp: string | null;
  hashscanUrl: string | null;
  status: "RECORDED" | "VERIFIED" | "PENDING_CONSENSUS" | "NOT_CONFIGURED";
  configured: boolean;
  explanation: string;
}

export interface HederaAuditConfig {
  accountId?: string;
  privateKey?: string;
  topicId?: string;
  mirrorUrl?: string;
  fetchImpl?: typeof fetch;
}

export const JUDGE_EXPLANATION =
  "Hedera was considered as an additional blockchain infrastructure layer for recording important project events and improving auditability. However, TRUSTORA's primary evidence-anchoring architecture uses Arkiv, while Arc handles optional payment settlement.";

export const TECH_ROLES = [
  { technology: "Hedera", role: "Optional blockchain-based project records and auditability" },
  { technology: "Arc", role: "USDC escrow and payment settlement" },
  { technology: "0G", role: "AI inference and computation" },
  { technology: "Arkiv", role: "Public, hash-only evidence anchoring" },
  { technology: "ProofTrack", role: "Evidence verification and project audit timeline" },
] as const;

export class HederaAuditService {
  private readonly accountId: string | null;
  private readonly privateKey: string | null;
  private readonly topicId: string | null;
  private readonly mirrorUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: HederaAuditConfig = {}) {
    this.accountId = cfg.accountId || process.env.HEDERA_ACCOUNT_ID || null;
    this.privateKey = cfg.privateKey || process.env.HEDERA_PRIVATE_KEY || null;
    this.topicId = cfg.topicId || process.env.HEDERA_TOPIC_ID || null;
    this.mirrorUrl = (cfg.mirrorUrl ?? TESTNET_MIRROR_URL).replace(/\/+$/, "");
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  public isConfigured(): boolean {
    return !!(this.accountId && this.privateKey && isHederaAccountId(this.accountId));
  }

  public getTopicHashScanUrl(): string | null {
    return this.topicId ? `https://hashscan.io/testnet/topic/${encodeURIComponent(this.topicId)}` : null;
  }

  /**
   * Computes deterministic SHA-256 hash of structured audit payload.
   */
  public computePayloadHash(details: Record<string, unknown>): string {
    const canonical = JSON.stringify(details, Object.keys(details).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Builds an audit record for agreement acceptance.
   */
  public recordAgreementAcceptance(params: {
    projectId: string;
    versionNumber: number;
    criteriaHash: string;
    clientAddress: string;
    freelancerAddress: string;
  }): HederaAuditRecordResult {
    return this.buildRecord("AGREEMENT_ACCEPTED", params.projectId, {
      versionNumber: params.versionNumber,
      criteriaHash: params.criteriaHash,
      clientAddress: params.clientAddress,
      freelancerAddress: params.freelancerAddress,
      action: "AGREEMENT_FROZEN_AND_ACCEPTED",
    });
  }

  /**
   * Builds an audit record for milestone completion.
   */
  public recordMilestoneCompletion(params: {
    projectId: string;
    milestoneIndex: number;
    deliverableHash: string;
    releasedTo: string;
    amountUsdc: number | string;
    releaseTxHash?: string;
  }): HederaAuditRecordResult {
    return this.buildRecord("MILESTONE_COMPLETED", params.projectId, {
      milestoneIndex: params.milestoneIndex,
      deliverableHash: params.deliverableHash,
      releasedTo: params.releasedTo,
      amountUsdc: params.amountUsdc,
      releaseTxHash: params.releaseTxHash ?? null,
      action: "ESCROW_FUNDS_RELEASED_TO_FREELANCER",
    });
  }

  /**
   * Builds an audit record for 0G AI activity verification.
   */
  public recordActivityVerification(params: {
    projectId: string;
    milestoneIndex: number;
    verdict: string;
    modelId?: string;
    requestId?: string;
    reportHash: string;
  }): HederaAuditRecordResult {
    return this.buildRecord("ACTIVITY_VERIFIED", params.projectId, {
      milestoneIndex: params.milestoneIndex,
      verdict: params.verdict,
      modelId: params.modelId ?? null,
      requestId: params.requestId ?? null,
      reportHash: params.reportHash,
      action: "0G_AI_ADVISORY_EVALUATION_COMPLETED",
    });
  }

  /**
   * Builds an audit record for generic transaction or audit reference.
   */
  public recordAuditReference(params: {
    projectId: string;
    referenceType: string;
    referenceValue: string;
    context?: Record<string, unknown>;
  }): HederaAuditRecordResult {
    return this.buildRecord("AUDIT_REFERENCE", params.projectId, {
      referenceType: params.referenceType,
      referenceValue: params.referenceValue,
      context: params.context ?? {},
      action: "EXTERNAL_AUDIT_REFERENCE_LOGGED",
    });
  }

  private buildRecord(
    activityType: HederaActivityType,
    projectId: string,
    details: Record<string, unknown>
  ): HederaAuditRecordResult {
    const timestamp = new Date().toISOString();
    const payloadHash = this.computePayloadHash(details);
    const configured = this.isConfigured();

    const payload: HederaAuditRecordPayload = {
      protocol: "TRUSTORA-HCS-v1",
      activityType,
      projectId,
      timestamp,
      payloadHash,
      details,
    };

    const recordId = `HEDERA-${activityType}-${projectId}-${payloadHash.slice(0, 10)}`;

    return {
      recordId,
      activityType,
      projectId,
      payload,
      payloadHash,
      topicId: this.topicId,
      transactionId: null,
      consensusTimestamp: null,
      hashscanUrl: this.getTopicHashScanUrl(),
      status: configured ? "PENDING_CONSENSUS" : "NOT_CONFIGURED",
      configured,
      explanation: configured
        ? `Hedera Testnet credentials active. Topic: ${this.topicId ?? "default"}`
        : "Hedera audit layer is optional and unconfigured. Primary public evidence anchoring is active via Arkiv & ProofTrack.",
    };
  }

  /**
   * Verifies an existing Hedera consensus record or transaction on the public Mirror Node.
   */
  public async verifyOnMirrorNode(transactionOrTimestamp: string): Promise<{
    verified: boolean;
    consensusTimestamp?: string;
    details?: Record<string, unknown>;
    hashscanUrl: string;
  }> {
    const mirrorTxId = toMirrorTransactionId(transactionOrTimestamp);
    const url = mirrorTxId
      ? `${this.mirrorUrl}/transactions/${encodeURIComponent(mirrorTxId)}`
      : `${this.mirrorUrl}/topics/messages/${encodeURIComponent(transactionOrTimestamp)}`;

    const hashscanUrl = hashScanTransactionUrl(transactionOrTimestamp);

    try {
      const res = await this.fetchImpl(url);
      if (!res.ok) {
        return { verified: false, hashscanUrl };
      }
      const data = await res.json() as Record<string, any>;
      const tx = Array.isArray(data.transactions) ? data.transactions[0] : data;
      const isOk = tx?.result === "SUCCESS" || tx?.consensus_timestamp !== undefined;
      return {
        verified: !!isOk,
        consensusTimestamp: tx?.consensus_timestamp,
        details: tx,
        hashscanUrl,
      };
    } catch {
      return { verified: false, hashscanUrl };
    }
  }
}
