import { OgError, type IntegrationHealth, type IntegrationStatus, type OgChatClient, type OgChatResponse } from "../../og/src/types";
import { canonicalJson, sha256Hex } from "./hash";
import { MAX_DELIVERABLE_CHARS, buildPrompt, newNonce, sanitizeDeliverable } from "./prompt";
import {
  evaluationInputSchema,
  modelOutputSchema,
  type EvaluationErrorCode,
  type EvaluationOutcome,
  type EvaluationReport,
  type Overall,
  type Verdict,
} from "./schema";

export const ADVISORY_NOTICE = "ADVISORY_ONLY_CANNOT_RELEASE_FUNDS" as const;

/** Overall is computed by TRUSTORA, never by the model. */
export function computeOverall(verdicts: Verdict[]): Overall {
  if (verdicts.length > 0 && verdicts.every((v) => v === "UNABLE_TO_ASSESS")) return "UNABLE_TO_ASSESS";
  if (verdicts.some((v) => v === "FAIL")) return "FAIL";
  if (verdicts.length > 0 && verdicts.every((v) => v === "PASS")) return "PASS";
  return "PARTIAL";
}

/** Tolerates a fenced block or surrounding prose. Returns undefined when no JSON object parses. */
export function extractJson(text: string): unknown {
  const tryParse = (s: string): unknown => {
    try { return JSON.parse(s) as unknown; } catch { return undefined; }
  };
  const direct = tryParse(text.trim());
  if (direct !== undefined) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    const v = tryParse(fenced[1].trim());
    if (v !== undefined) return v;
  }
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return tryParse(text.slice(start, i + 1));
    }
  }
  return undefined;
}

function deliverableText(submission: { kind: string; text?: string; files?: Array<{ path: string; content: string }> }): string {
  if (submission.kind === "other") return "";
  // Filenames are NOT included: they are attacker-controlled and are not part of what we judge.
  const parts = [submission.text ?? "", ...(submission.files ?? []).map((f) => f.content)];
  return parts.join("\n").trim();
}

const PROVIDER_CODES: Record<string, EvaluationErrorCode> = {
  UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  BAD_RESPONSE: "PROVIDER_UNAVAILABLE",
  NO_REQUEST_ID: "PROVIDER_UNAVAILABLE",
};

export interface EvaluatorOptions {
  client: OgChatClient;
  /** Bounded retries for schema-invalid model output. Default 2 attempts total. */
  maxAttempts?: number;
}

export class Evaluator {
  private readonly client: OgChatClient;
  private readonly maxAttempts: number;
  private lastOutcome: "none" | "success" | { failure: EvaluationErrorCode } = "none";

  constructor(opts: EvaluatorOptions) {
    this.client = opts.client;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  }

  private finish(report: Omit<EvaluationReport, "reportHash">): EvaluationOutcome {
    return { ok: true, report: { ...report, reportHash: sha256Hex(canonicalJson(report)) } };
  }

  async evaluate(rawInput: unknown): Promise<EvaluationOutcome> {
    const parsed = evaluationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, error: { code: "INVALID_INPUT", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
    }
    const input = parsed.data;
    if (!input.aiConsentGiven) {
      return { ok: false, error: { code: "CONSENT_REQUIRED", message: "AI evaluation requires explicit client consent; no provider call was made" } };
    }

    const raw = deliverableText(input.submission);
    const empty = raw.length === 0;
    if (input.submission.kind === "other" || empty) {
      const why = input.submission.kind === "other"
        ? `Submission kind "other" is not supported for automated evaluation; no model was called.`
        : "The deliverable had no readable text content; no model was called.";
      return this.finish({
        criteriaVersion: input.criteriaVersion,
        submissionHash: input.submissionHash,
        overall: "UNABLE_TO_ASSESS",
        criteria: input.criteria.map((c) => ({ id: c.id, text: c.text, verdict: "UNABLE_TO_ASSESS" as Verdict, evidence: "" })),
        limitations: [why, "This report is advisory only and cannot release or refund funds."],
        modelCalled: false,
        attempts: 0,
        requestId: null, requestIdSource: null, chatId: null, modelId: null, providerAddress: null,
        teeVerified: null, teeVerifiedBy: null, trustModeRequested: null, promptHash: null,
        advisoryNotice: ADVISORY_NOTICE,
      });
    }

    const clean = sanitizeDeliverable(raw);
    let last: OgChatResponse | undefined;
    let promptHash: string | null = null;
    let attempts = 0;
    let invalidDetail = "";

    while (attempts < this.maxAttempts) {
      attempts++;
      const { system, user, promptHash: ph } = buildPrompt({
        criteriaVersion: input.criteriaVersion,
        criteria: input.criteria,
        submissionHash: input.submissionHash,
        deliverable: clean.text,
        nonce: newNonce(),
      });
      promptHash = ph;
      let res: OgChatResponse;
      try {
        res = await this.client.chat({ system, user, temperature: 0.1, maxTokens: 1500 });
      } catch (e) {
        const code = e instanceof OgError ? (PROVIDER_CODES[e.code] ?? "PROVIDER_UNAVAILABLE") : "PROVIDER_UNAVAILABLE";
        this.lastOutcome = { failure: code };
        return { ok: false, error: { code, message: e instanceof Error ? e.message : "provider error" } }; // provider errors are NOT retried
      }
      last = res;

      const shape = modelOutputSchema.safeParse(extractJson(res.content));
      if (!shape.success) {
        invalidDetail = shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || "output was not the agreed JSON object";
        continue;
      }
      const ids = shape.data.results.map((r) => r.id);
      const expected = input.criteria.map((c) => c.id);
      if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
        invalidDetail = `model returned ids [${ids.join(",")}], expected exactly [${expected.join(",")}] in order`;
        continue; // never repaired by inventing or reordering fields
      }

      const byId = new Map(shape.data.results.map((r) => [r.id, r]));
      const criteria = input.criteria.map((c) => {
        const r = byId.get(c.id)!;
        return { id: c.id, text: c.text, verdict: r.verdict, evidence: r.evidence }; // text copied from the agreed criteria
      });
      const limitations = [...(shape.data.limitations ?? []).slice(0, 10), ...this.codeLimitations(clean, res)];
      this.lastOutcome = "success";
      return this.finish({
        criteriaVersion: input.criteriaVersion,
        submissionHash: input.submissionHash,
        overall: computeOverall(criteria.map((c) => c.verdict)),
        criteria,
        limitations,
        modelCalled: true,
        attempts,
        requestId: res.requestId,
        requestIdSource: res.requestIdSource,
        chatId: res.chatId,
        modelId: res.modelId,
        providerAddress: res.providerAddress,
        teeVerified: res.teeVerified,
        teeVerifiedBy: res.teeVerifiedBy,
        trustModeRequested: res.trustModeRequested,
        promptHash,
        advisoryNotice: ADVISORY_NOTICE,
      });
    }

    this.lastOutcome = { failure: "MODEL_OUTPUT_INVALID" };
    return {
      ok: false,
      error: {
        code: "MODEL_OUTPUT_INVALID",
        message: `model output did not match the agreed schema after ${attempts} attempt(s): ${invalidDetail}` +
          (last ? ` (last requestId ${last.requestId})` : ""),
      },
    };
  }

  /** Limitations TRUSTORA appends itself, never taken from the model. */
  private codeLimitations(clean: { truncated: boolean; boundaryTextStripped: boolean; originalLength: number }, res: OgChatResponse): string[] {
    const out: string[] = [];
    if (clean.truncated) {
      out.push(`Only the first ${MAX_DELIVERABLE_CHARS} of ${clean.originalLength} characters of the deliverable were evaluated (truncated at 24000 chars); later content was not assessed.`);
    }
    if (clean.boundaryTextStripped) {
      out.push("The deliverable contained text imitating the evaluator's boundary markers or invisible characters; it was stripped before evaluation.");
    }
    if (res.teeVerified === true) {
      out.push(`TEE attestation is ${res.teeVerifiedBy === "sdk-independent" ? "independently checked via the 0G SDK" : "router-reported only and NOT independently confirmed by TRUSTORA"}.`);
    } else if (res.teeVerified === false) {
      out.push("WARNING: the provider reported that TEE verification FAILED for this inference; treat the result as unattested.");
    } else {
      out.push("TEE attestation status for this inference is unknown (no flag was returned).");
    }
    out.push("This report is advisory only and cannot release or refund funds.");
    return out;
  }

  /** CONNECTED only after a real successful evaluation. Never VERIFIED. */
  async health(): Promise<IntegrationHealth> {
    const checkedAt = new Date().toISOString();
    if (this.lastOutcome === "success") return { status: "CONNECTED", detail: "a real inference succeeded in this process", checkedAt };
    if (typeof this.lastOutcome === "object") {
      const code = this.lastOutcome.failure;
      const status: IntegrationStatus =
        code === "PROVIDER_NOT_CONFIGURED" ? "NOT_CONFIGURED" : code === "PROVIDER_UNAVAILABLE" ? "UNAVAILABLE" : "DEGRADED";
      return { status, detail: `last evaluation failed with ${code}`, checkedAt };
    }
    const h = await this.client.healthCheck();
    const clamped: IntegrationStatus = h.status === "CONNECTED" || h.status === "VERIFIED" ? "CONFIGURED" : h.status;
    return { status: clamped, detail: h.detail, checkedAt: h.checkedAt };
  }
}
