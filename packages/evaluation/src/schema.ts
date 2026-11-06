import { z } from "zod";

export const VERDICTS = ["PASS", "FAIL", "UNABLE_TO_ASSESS"] as const;
export const OVERALLS = ["PASS", "FAIL", "PARTIAL", "UNABLE_TO_ASSESS"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Overall = (typeof OVERALLS)[number];

export const SUBMISSION_KINDS = ["text", "code", "static_project", "other"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const criterionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
});

export const submissionSchema = z.strictObject({
  kind: z.enum(SUBMISSION_KINDS),
  name: z.string().min(1).max(200),
  text: z.string().optional(),
  files: z.array(z.strictObject({ path: z.string().min(1), content: z.string() })).optional(),
});

export const evaluationInputSchema = z
  .strictObject({
    criteriaVersion: z.string().min(1).max(64),
    criteria: z.array(criterionSchema).min(1).max(10),
    submission: submissionSchema,
    submissionHash: z.string().regex(/^[0-9a-f]{64}$/, "submissionHash must be 64 lowercase hex chars"),
    aiConsentGiven: z.boolean(),
  })
  .refine((v) => new Set(v.criteria.map((c) => c.id)).size === v.criteria.length, { message: "criteria ids must be unique" });

export type EvaluationInput = z.infer<typeof evaluationInputSchema>;

/** What the model is allowed to return. Strict: no extra fields, NO `overall` (TRUSTORA computes that). */
export const modelOutputSchema = z.strictObject({
  results: z
    .array(z.strictObject({ id: z.string().min(1), verdict: z.enum(VERDICTS), evidence: z.string().max(2000) }))
    .min(1)
    .max(10),
  limitations: z.array(z.string().max(500)).max(10).optional(),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

export const draftOutputSchema = z.strictObject({
  criteria: z.array(z.strictObject({ id: z.string().min(1).max(64), text: z.string().min(1).max(500) })).min(3).max(5),
});

export type EvaluationErrorCode =
  | "INVALID_INPUT"
  | "CONSENT_REQUIRED"
  | "MODEL_OUTPUT_INVALID"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED"
  | "INSUFFICIENT_FUNDS";

export interface EvaluationReport {
  criteriaVersion: string;
  submissionHash: string;
  overall: Overall;
  criteria: Array<{ id: string; text: string; verdict: Verdict; evidence: string }>;
  limitations: string[];
  modelCalled: boolean;
  attempts: number;
  /** INFERENCE_REQUEST_ID, never a transaction hash. null when no model was called. */
  requestId: string | null;
  requestIdSource: string | null;
  chatId: string | null;
  modelId: string | null;
  providerAddress: string | null;
  teeVerified: boolean | null;
  teeVerifiedBy: "router-reported" | "sdk-independent" | null;
  trustModeRequested: string | null;
  promptHash: string | null;
  advisoryNotice: "ADVISORY_ONLY_CANNOT_RELEASE_FUNDS";
  reportHash: string;
}

export type EvaluationOutcome =
  | { ok: true; report: EvaluationReport }
  | { ok: false; error: { code: EvaluationErrorCode; message: string } };
