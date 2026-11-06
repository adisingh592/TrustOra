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
  REFERENCE_TYPES,
  VERIFICATION_STATUSES,
} from "./enums.js";
import { PROOF_EVENT_TYPES, type ProofEvent } from "./proofevent.js";

export const EcosystemSchema = z.enum(ECOSYSTEMS);
export const ReferenceTypeSchema = z.enum(REFERENCE_TYPES);
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export const CriterionStatusSchema = z.enum(CRITERION_STATUSES);
export const MilestoneStatusSchema = z.enum(MILESTONE_STATUSES);
export const ProofEventTypeSchema = z.enum(PROOF_EVENT_TYPES);

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
