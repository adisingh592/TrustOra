import type { Ecosystem, ReferenceType, VerificationStatus } from "./enums.js";

/** Event types used this sprint. */
export const PROOF_EVENT_TYPES = [
  "AGREEMENT_ACCEPTED_CLIENT",
  "AGREEMENT_ACCEPTED_FREELANCER",
  "MILESTONE_FUNDED",
  "WORK_SUBMITTED",
  "EVALUATION_COMPLETED",
  "MILESTONE_APPROVED",
  "PAYMENT_RELEASED",
  "AGENT_PAYMENT_SETTLED",
  "AGENT_PAYMENT_DENIED",
] as const;
export type ProofEventType = (typeof PROOF_EVENT_TYPES)[number];

export interface ProofEvent {
  id: string;
  publicProjectId: string;
  milestoneId?: string;
  occurredAt: string;
  ecosystem: Ecosystem;
  network: string;
  chainId?: number;
  eventType: string;
  referenceType: ReferenceType;
  referenceValue: string;
  verificationStatus: VerificationStatus;
  verifiedAt?: string;
  explorerUrl?: string;
  summary: string;
}
