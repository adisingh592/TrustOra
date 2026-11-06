export const ECOSYSTEMS = ["ARC", "ZERO_G", "HEDERA", "APPLICATION", "ARKIV"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export const REFERENCE_TYPES = [
  "BLOCKCHAIN_TRANSACTION_HASH",
  "INFERENCE_REQUEST_ID",
  "STORAGE_REFERENCE",
  "FACILITATOR_SETTLEMENT_ID",
  "APPLICATION_EVENT_ID",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const VERIFICATION_STATUSES = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "UNAVAILABLE",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const INTEGRATION_STATUSES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "CONNECTED",
  "ACTIVITY_DETECTED",
  "VERIFIED",
  "DEGRADED",
  "BLOCKED",
  "FAILED",
  "UNAVAILABLE",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const CRITERION_STATUSES = [
  "PASS",
  "PARTIAL",
  "FAIL",
  "UNABLE_TO_ASSESS",
] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const PROJECT_STATUSES = [
  "DRAFT",
  "AGREED",
  "FUNDED",
  "ACTIVE",
  "COMPLETED",
  "DISPUTED",
  "CANCELLED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MILESTONE_STATUSES = [
  "DRAFT",
  "AGREED",
  "FUNDED",
  "WORK_SUBMITTED",
  "REVISION_REQUESTED",
  "APPROVED",
  "RELEASED",
  "DISPUTED",
  "RESOLVED",
  "REFUNDED",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PAYMENT_MODES = ["ARC_ESCROW", "EXTERNAL_PAYMENT"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCOPE_CHANGE_TYPES = [
  "ADDED",
  "REMOVED",
  "MODIFIED",
  "UNCHANGED",
] as const;
export type ScopeChangeType = (typeof SCOPE_CHANGE_TYPES)[number];

