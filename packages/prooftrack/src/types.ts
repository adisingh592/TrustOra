/**
 * @file types.ts
 * @description Type definitions for Trustora ProofTrack event correlation.
 */

export type ProofTrackReferenceType =
  | "BLOCKCHAIN_TRANSACTION_HASH"
  | "INFERENCE_REQUEST_ID"
  | "STORAGE_REFERENCE"
  | "FACILITATOR_SETTLEMENT_ID"
  | "APPLICATION_EVENT_ID";

export type ProofTrackEcosystem =
  | "ARC"
  | "ZERO_G"
  | "HEDERA"
  | "TRUSTORA_CORE";

export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "FAILED";

export interface ProofTrackEvent {
  id: string;
  projectId: string;                 // e.g. TRU-PROJ-2026-0001042
  milestoneId?: number;
  sequence: number;
  timestamp: string;
  ecosystem: ProofTrackEcosystem;
  eventType: string;                 // e.g. ESCROW_FUNDED, 0G_EVALUATION_COMPLETED, HEDERA_AGENT_SETTLED, ESCROW_RELEASED
  referenceType: ProofTrackReferenceType;
  referenceValue: string;
  explorerUrl?: string | null;
  verificationStatus: VerificationStatus;
  verifiedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProofTrackTimeline {
  projectId: string;
  createdAt: string;
  events: ProofTrackEvent[];
  completionRatio: number;           // 0.0 to 1.0
  isFullySettled: boolean;
  totalMilestones: number;
  releasedMilestones: number;
}

