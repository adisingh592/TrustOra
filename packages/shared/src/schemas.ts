import { isAddress } from "viem";
import { z } from "zod";
import type {
  AgentPaymentRequest,
  AgentPaymentResult,
  EscrowState,
  EvaluationInput,
  EvaluationResult,
  IntegrationHealth,
  VerifiedChainEvent,
  VerifiedSettlement,
} from "./adapters.js";
import {
  CRITERION_STATUSES,
  ECOSYSTEMS,
  INTEGRATION_STATUSES,
  MILESTONE_STATUSES,
  PAYMENT_MODES,
  PROJECT_STATUSES,
  REFERENCE_TYPES,
  RISK_LEVELS,
  SCOPE_CHANGE_TYPES,
  VERIFICATION_STATUSES,
} from "./enums.js";
import { PROOF_EVENT_TYPES, type ProofEvent } from "./proofevent.js";

export const EcosystemSchema = z.enum(ECOSYSTEMS);
export const ReferenceTypeSchema = z.enum(REFERENCE_TYPES);
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export const CriterionStatusSchema = z.enum(CRITERION_STATUSES);
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export const MilestoneStatusSchema = z.enum(MILESTONE_STATUSES);
export const ProofEventTypeSchema = z.enum(PROOF_EVENT_TYPES);
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export const RiskLevelSchema = z.enum(RISK_LEVELS);
export const ScopeChangeTypeSchema = z.enum(SCOPE_CHANGE_TYPES);

/** Whole base units as a string, so "1.5" and 1500000 are both rejected. */
const BaseUnitAmountSchema = z.string().regex(/^\d+$/);

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const ProofEventSchema = z
  .object({
    id: z.string(),
    publicProjectId: z.string(),
    milestoneId: z.string().optional(),
    occurredAt: z.string(),
    ecosystem: EcosystemSchema,
    network: z.string(),
    chainId: z.number().optional(),
    eventType: z.string(),
    referenceType: ReferenceTypeSchema,
    referenceValue: z.string(),
    verificationStatus: VerificationStatusSchema,
    verifiedAt: z.string().optional(),
    explorerUrl: z.string().optional(),
    summary: z.string(),
  })
  .superRefine((event, ctx) => {
    if (
      event.referenceType === "BLOCKCHAIN_TRANSACTION_HASH" &&
      !TRANSACTION_HASH_PATTERN.test(event.referenceValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceValue"],
        message: "BLOCKCHAIN_TRANSACTION_HASH must match /^0x[0-9a-fA-F]{64}$/",
      });
    }
  }) satisfies z.ZodType<ProofEvent>;

export const IntegrationHealthSchema = z.object({
  status: IntegrationStatusSchema,
  detail: z.string(),
  checkedAt: z.string(),
}) satisfies z.ZodType<IntegrationHealth>;

export const EscrowStateSchema = z.object({
  milestoneId: z.string(),
  client: z.string(),
  freelancer: z.string(),
  arbiter: z.string(),
  token: z.string(),
  amount: BaseUnitAmountSchema,
  agreementHash: z.string(),
  deliverableHash: z.string().optional(),
  deadline: z.string(),
  status: MilestoneStatusSchema,
}) satisfies z.ZodType<EscrowState>;

export const VerifiedChainEventSchema = z.object({
  txHash: z.string(),
  chainId: z.number(),
  contractAddress: z.string(),
  milestoneId: z.string(),
  amount: BaseUnitAmountSchema,
  token: z.string(),
  freelancer: z.string(),
  agreementHash: z.string(),
  blockNumber: z.number(),
  verified: z.boolean(),
  explorerUrl: z.string().optional(),
}) satisfies z.ZodType<VerifiedChainEvent>;

export const EvaluationInputSchema = z.object({
  criteria: z.array(z.string()),
  criteriaVersion: z.string(),
  submissionDescriptor: z.string(),
  submissionHash: z.string(),
  consent: z.boolean(),
}) satisfies z.ZodType<EvaluationInput>;

export const EvaluationResultSchema = z.object({
  overall: CriterionStatusSchema,
  criteria: z.array(
    z.object({
      criterion: z.string(),
      status: CriterionStatusSchema,
      evidence: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
  suggestedRevisions: z.array(z.string()),
  criteriaVersion: z.string(),
  submissionHash: z.string(),
  modelId: z.string(),
  promptHash: z.string(),
  requestId: z.string(),
  reportHash: z.string(),
}) satisfies z.ZodType<EvaluationResult>;

export const AgentPaymentRequestSchema = z.object({
  providerPayTo: z.string(),
  amount: BaseUnitAmountSchema,
  network: z.string(),
  asset: z.string(),
  resourceUrl: z.string(),
}) satisfies z.ZodType<AgentPaymentRequest>;

export const AgentPaymentResultSchema = z.object({
  status: z.string(),
  settlementRef: z.string().optional(),
  reason: z.string().optional(),
}) satisfies z.ZodType<AgentPaymentResult>;

export const VerifiedSettlementSchema = z.object({
  ref: z.string(),
  verified: z.boolean(),
  network: z.string(),
}) satisfies z.ZodType<VerifiedSettlement>;

/** One billion USDC in base units (6 decimals). */
export const MAX_AMOUNT_BASE_UNITS = 1_000_000_000_000_000n;

/** Positive whole base units as a string, with no leading zeros. */
export const PositiveAmountSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,77}$/, "must be a positive whole number of base units, as a string")
  // pipe, so BigInt only ever sees a string that passed the format check.
  .pipe(z.string().refine((value) => BigInt(value) <= MAX_AMOUNT_BASE_UNITS, "is above the maximum amount"));

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/** A valid address, including its checksum if mixed case. Output is lowercase. */
export const WalletAddressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: true }), "must be a valid wallet address")
  .transform((value) => value.toLowerCase())
  .refine((value) => value !== ZERO_ADDRESS, "must not be the zero address");

export const PublicProjectIdSchema = z.string().regex(/^TRU-PROJ-2026-[0-9]{7}$/);

/** Output is always the same ISO form, so equal times hash the same. */
const DeadlineSchema = z
  .string()
  .datetime({ message: "must be an ISO 8601 UTC time" })
  .transform((value) => new Date(value).toISOString());

const milestoneTerms = {
  title: z.string().trim().min(1).max(120),
  amount: PositiveAmountSchema,
  deadline: DeadlineSchema,
  criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
};

// Strict: a client cannot send a hash, status, role or milestone key of its own.
export const CreateProjectBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    freelancerWallet: WalletAddressSchema,
    arbiterWallet: WalletAddressSchema,
    paymentMode: PaymentModeSchema.default("ARC_ESCROW"),
    milestones: z.array(z.object(milestoneTerms).strict()).min(1).max(10),
  })
  .strict();
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const ProposeVersionBodySchema = z
  .object({
    milestones: z
      .array(z.object({ id: z.string().min(1).max(100), ...milestoneTerms }).strict())
      .min(1)
      .max(10),
  })
  .strict();
export type ProposeVersionBody = z.infer<typeof ProposeVersionBodySchema>;

export const AcceptAgreementBodySchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export type AcceptAgreementBody = z.infer<typeof AcceptAgreementBodySchema>;

const HEX_32_BYTES = /^(0x)?[0-9a-fA-F]{64}$/;
const Hash32Schema = z
  .string()
  .regex(HEX_32_BYTES, "must be 32 bytes of hex")
  .transform((value) => value.toLowerCase());

/**
 * What a verifier must compare against, supplied by server code from our own
 * database. Strict, so nothing else, such as a file path, can be stored here.
 */
export const ProofEventExpectedSchema = z
  .object({
    onchainMilestoneId: Hash32Schema.optional(),
    amountBaseUnits: PositiveAmountSchema.optional(),
    tokenAddress: WalletAddressSchema.optional(),
    clientWallet: WalletAddressSchema.optional(),
    freelancerWallet: WalletAddressSchema.optional(),
    arbiterWallet: WalletAddressSchema.optional(),
    agreementHash: Hash32Schema.optional(),
    deliverableSha256: Hash32Schema.optional(),
    /** On EVIDENCE_ANCHORED: which ProofTrack event this anchor is for. */
    sourceEventId: z.string().min(1).max(100).optional(),
    /** On EVIDENCE_ANCHORED: estimated expiry. Anchors expire. */
    anchorExpiresAt: z.string().datetime().optional(),
  })
  .strict();
export type ProofEventExpected = z.output<typeof ProofEventExpectedSchema>;

/** Input for recording an event. Server code only: no route accepts this. */
export const RecordProofEventInputSchema = z
  .object({
    publicProjectId: PublicProjectIdSchema,
    milestoneId: z.string().min(1).max(100).optional(),
    occurredAt: z
      .string()
      .datetime({ message: "must be an ISO 8601 UTC time" })
      .transform((value) => new Date(value).toISOString()),
    ecosystem: EcosystemSchema,
    network: z.string().trim().min(1).max(100),
    chainId: z.number().int().positive().optional(),
    eventType: ProofEventTypeSchema,
    referenceType: ReferenceTypeSchema,
    referenceValue: z.string(),
    expected: ProofEventExpectedSchema.default({}),
  })
  .strict();
export type RecordProofEventInput = z.output<typeof RecordProofEventInputSchema>;

/** An Arkiv entity key: exactly 32 bytes of 0x hex (SDK 1.0.1, key() in schema/values). */
export const AnchorEntityKeySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters")
  .transform((value) => value.toLowerCase());

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase SHA-256 hex");
/** Arkiv limits a str value to 128 bytes of UTF-8. Printable ASCII is one byte per character. */
const AnchorTextSchema = z.string().regex(/^[\x20-\x7e]{1,128}$/, "must be up to 128 printable characters");

/**
 * Everything written to Arkiv, which is public. Strict, so no other field, such as a
 * file name, title or criteria, can ever be part of it.
 */
export const AnchorPayloadSchema = z
  .object({
    projectId: PublicProjectIdSchema,
    eventType: ProofEventTypeSchema,
    eventDigest: Sha256HexSchema,
    subjectDigest: Sha256HexSchema.optional(),
    network: AnchorTextSchema,
    reference: AnchorTextSchema,
    occurredAt: z.string().datetime(),
  })
  .strict();
export type AnchorPayload = z.output<typeof AnchorPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* TAEVA (Trustora Adaptive Evidence Verification Algorithm) Schemas          */
/* -------------------------------------------------------------------------- */

export const EVALUATION_SOURCES = ["DETERMINISTIC_HEURISTIC", "ZERO_G_INFERENCE"] as const;
export const EvaluationSourceSchema = z.enum(EVALUATION_SOURCES);
export type EvaluationSource = z.infer<typeof EvaluationSourceSchema>;

export const TaevaCriterionResultSchema = z
  .object({
    criterion: z.string().trim().min(1),
    status: CriterionStatusSchema,
    evidence: z.string().trim().min(1),
    advisoryNotes: z.string().optional(),
  })
  .strict();
export type TaevaCriterionResult = z.infer<typeof TaevaCriterionResultSchema>;

export const TaevaEvaluationReportSchema = z
  .object({
    milestoneId: z.string(),
    submissionId: z.string(),
    fileHash: z.string(),
    deterministicChecks: z.object({
      hashVerified: z.boolean(),
      deadlineMet: z.boolean(),
      agreementAccepted: z.boolean(),
      aiConsentGranted: z.boolean(),
    }),
    criteriaResults: z.array(TaevaCriterionResultSchema),
    overallStatus: CriterionStatusSchema,
    isAdvisory: z.literal(true),
    evaluatedAt: z.string(),
    explanation: z.string(),
    requestId: z.string(),
    reportHash: z.string(),
    /** DETERMINISTIC_HEURISTIC unless a real 0G adapter produced this report. */
    evaluationSource: EvaluationSourceSchema,
    /** True only when evaluationSource is ZERO_G_INFERENCE. */
    isAI: z.boolean(),
    /** Plain-language note on which path produced this report. */
    evaluationNote: z.string(),
  })
  .strict();
export type TaevaEvaluationReport = z.infer<typeof TaevaEvaluationReportSchema>;

/* -------------------------------------------------------------------------- */
/* ScopeGuard (Scope Change Detection) Schemas                                */
/* -------------------------------------------------------------------------- */

export const ScopeChangeCriterionDiffSchema = z
  .object({
    type: ScopeChangeTypeSchema,
    criterion: z.string(),
    previousCriterion: z.string().optional(),
  })
  .strict();
export type ScopeChangeCriterionDiff = z.infer<typeof ScopeChangeCriterionDiffSchema>;

export const ScopeChangeMilestoneDiffSchema = z
  .object({
    milestoneId: z.string(),
    title: z.string(),
    type: ScopeChangeTypeSchema,
    deadlineShiftDays: z.number(),
    amountDeltaBaseUnits: z.string(),
    criteriaDiffs: z.array(ScopeChangeCriterionDiffSchema),
  })
  .strict();
export type ScopeChangeMilestoneDiff = z.infer<typeof ScopeChangeMilestoneDiffSchema>;

export const ScopeGuardReportSchema = z
  .object({
    publicProjectId: PublicProjectIdSchema,
    baseVersion: z.number().int().positive(),
    targetVersion: z.number().int().positive(),
    hasChanges: z.boolean(),
    milestoneDiffs: z.array(ScopeChangeMilestoneDiffSchema),
    totalAmountDeltaBaseUnits: z.string(),
    totalDeadlineShiftDays: z.number(),
    timelineRisk: RiskLevelSchema,
    costRisk: RiskLevelSchema,
    overallRisk: RiskLevelSchema,
    approvalStatus: z.object({
      clientAccepted: z.boolean(),
      freelancerAccepted: z.boolean(),
      isFullyAccepted: z.boolean(),
    }),
    summary: z.string(),
  })
  .strict();
export type ScopeGuardReport = z.infer<typeof ScopeGuardReportSchema>;

/* -------------------------------------------------------------------------- */
/* TrustShield (Reliability & Risk Analysis) Schemas                          */
/* -------------------------------------------------------------------------- */

export const TrustRiskIndicatorSchema = z
  .object({
    level: RiskLevelSchema,
    reason: z.string(),
    details: z.record(z.string(), z.any()).optional(),
  })
  .strict();
export type TrustRiskIndicator = z.infer<typeof TrustRiskIndicatorSchema>;

export const TrustShieldReportSchema = z
  .object({
    publicProjectId: PublicProjectIdSchema,
    evaluatedAt: z.string(),
    deadlineAdherence: TrustRiskIndicatorSchema,
    scopeVolatility: TrustRiskIndicatorSchema,
    submissionHistory: TrustRiskIndicatorSchema,
    disputeHistory: TrustRiskIndicatorSchema,
    overallRisk: RiskLevelSchema,
    overallConfidence: z.number().min(0).max(1),
    explanation: z.string(),
    heuristicNotes: z.array(z.string()),
  })
  .strict();
export type TrustShieldReport = z.infer<typeof TrustShieldReportSchema>;

/* -------------------------------------------------------------------------- */
/* Unified Trust Report Schemas                                               */
/* -------------------------------------------------------------------------- */

export const UnifiedTrustReportSchema = z
  .object({
    publicProjectId: PublicProjectIdSchema,
    paymentMode: PaymentModeSchema,
    generatedAt: z.string(),
    projectStatus: ProjectStatusSchema,
    taevaSummary: z.object({
      totalMilestones: z.number().int().nonnegative(),
      evaluatedMilestones: z.number().int().nonnegative(),
      evaluations: z.array(TaevaEvaluationReportSchema),
    }),
    scopeGuardSummary: z.object({
      totalVersions: z.number().int().positive(),
      activeVersion: z.number().int().positive(),
      hasPendingProposals: z.boolean(),
      latestScopeChange: ScopeGuardReportSchema.optional(),
    }),
    trustShieldSummary: TrustShieldReportSchema,
    proofTrackSummary: z.object({
      totalEvents: z.number().int().nonnegative(),
      verifiedCount: z.number().int().nonnegative(),
      pendingCount: z.number().int().nonnegative(),
      failedCount: z.number().int().nonnegative(),
      ecosystemsInvolved: z.array(EcosystemSchema),
    }),
    verifiableReportHash: z.string(),
    disclaimer: z.string(),
  })
  .strict();
export type UnifiedTrustReport = z.infer<typeof UnifiedTrustReportSchema>;

