import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, undefined dropped. Used for promptHash/reportHash. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const inner = (v as Record<string, unknown>)[k];
        if (inner !== undefined) out[k] = norm(inner);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(typeof input === "string" ? Buffer.from(input, "utf8") : input).digest("hex");
