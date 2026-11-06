/**
 * @file engine.ts
 * @description ProofTrack correlation engine connecting Arc, 0G, Hedera and application events.
 */

import {
  ProofTrackEcosystem,
  ProofTrackEvent,
  ProofTrackReferenceType,
  ProofTrackTimeline,
  VerificationStatus,
} from "./types";

export function generateProjectId(year = 2026, sequenceNumber = 1042): string {
  const paddedSeq = String(sequenceNumber).padStart(7, "0");
  return `TRU-PROJ-${year}-${paddedSeq}`;
}

export class ProofTrackEngine {
  private events: Map<string, ProofTrackEvent[]> = new Map();

  /**
   * Generates explorer URL based on ecosystem and reference type.
   */
  public static getExplorerUrl(
    ecosystem: ProofTrackEcosystem,
    referenceType: ProofTrackReferenceType,
    referenceValue: string
  ): string | null {
    if (!referenceValue) return null;

    if (ecosystem === "ARC" && referenceType === "BLOCKCHAIN_TRANSACTION_HASH") {
      return `https://explorer.testnet.arc.io/tx/${referenceValue}`;
    }

    if (ecosystem === "HEDERA" && (referenceType === "FACILITATOR_SETTLEMENT_ID" || referenceType === "BLOCKCHAIN_TRANSACTION_HASH")) {
      return `https://hashscan.io/testnet/transaction/${encodeURIComponent(referenceValue)}`;
    }

    if (ecosystem === "ZERO_G" && referenceType === "STORAGE_REFERENCE") {
      return `https://storagescan-testnet.0g.ai/file/${encodeURIComponent(referenceValue)}`;
    }

    // Per specifications: A 0G inference request ID is NOT a blockchain tx hash and has NO explorer URL.
    if (ecosystem === "ZERO_G" && referenceType === "INFERENCE_REQUEST_ID") {
      return null;
    }

    return null;
  }

  /**
   * Appends an event to a project's ProofTrack timeline.
   */
  public recordEvent(
    projectId: string,
    eventData: {
      milestoneId?: number;
      ecosystem: ProofTrackEcosystem;
      eventType: string;
      referenceType: ProofTrackReferenceType;
      referenceValue: string;
      verificationStatus?: VerificationStatus;
      metadata?: Record<string, unknown>;
    }
  ): ProofTrackEvent {
    const projectEvents = this.events.get(projectId) || [];
    const nextSequence = projectEvents.length + 1;
    const eventId = `${projectId}-EVT-${String(nextSequence).padStart(4, "0")}`;

    const explorerUrl = ProofTrackEngine.getExplorerUrl(
      eventData.ecosystem,
      eventData.referenceType,
      eventData.referenceValue
    );

    const newEvent: ProofTrackEvent = {
      id: eventId,
      projectId,
      milestoneId: eventData.milestoneId,
      sequence: nextSequence,
      timestamp: new Date().toISOString(),
      ecosystem: eventData.ecosystem,
      eventType: eventData.eventType,
      referenceType: eventData.referenceType,
      referenceValue: eventData.referenceValue,
      explorerUrl,
      verificationStatus: eventData.verificationStatus || "PENDING",
      verifiedAt: eventData.verificationStatus === "VERIFIED" ? new Date().toISOString() : null,
      metadata: eventData.metadata,
    };

    projectEvents.push(newEvent);
    this.events.set(projectId, projectEvents);
    return newEvent;
  }

  /**
   * Retrieves the full correlated timeline for a project.
   */
  public getTimeline(projectId: string, totalMilestones = 1): ProofTrackTimeline {
    const projectEvents = this.events.get(projectId) || [];
    const releasedCount = projectEvents.filter(
      (e) => e.eventType === "ESCROW_RELEASED" && e.ecosystem === "ARC"
    ).length;

    const completionRatio = totalMilestones > 0 ? releasedCount / totalMilestones : 0;
    const isFullySettled = totalMilestones > 0 && releasedCount >= totalMilestones;

    return {
      projectId,
      createdAt: projectEvents[0]?.timestamp || new Date().toISOString(),
      events: [...projectEvents],
      completionRatio,
      isFullySettled,
      totalMilestones,
      releasedMilestones: releasedCount,
    };
  }

  /**
   * Verifies an on-chain transaction hash against Arc Testnet RPC.
   */
  public async verifyArcTransaction(
    rpcUrl: string,
    txHash: string
  ): Promise<{ isVerified: boolean; blockNumber?: number; error?: string }> {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [txHash],
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { isVerified: false, error: `HTTP_${response.status}` };
      }

      const json = (await response.json()) as any;
      const receipt = json.result;
      if (!receipt) {
        return { isVerified: false, error: "RECEIPT_NOT_FOUND_YET" };
      }

      // Check status: '0x1' is success in EVM receipts
      const isSuccess = receipt.status === "0x1" || receipt.status === 1;
      const blockNum = parseInt(receipt.blockNumber, 16);

      return {
        isVerified: isSuccess,
        blockNumber: isNaN(blockNum) ? undefined : blockNum,
        error: isSuccess ? undefined : "TRANSACTION_REVERTED_ON_CHAIN",
      };
    } catch (err: any) {
      return { isVerified: false, error: err.message || String(err) };
    }
  }
}

