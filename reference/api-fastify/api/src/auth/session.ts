import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SESSION_COOKIE = "trustora_session";
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

const SessionPayloadSchema = z.object({
  userId: z.string().min(1),
  /** Expiry as Unix seconds. */
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export interface SessionCodec {
  sign(userId: string): string;
  /** Returns null for anything tampered, malformed or expired. */
  verify(token: unknown): SessionPayload | null;
}

/** Sessions are stateless, so logout cannot revoke a copied cookie before it expires. */
export const createSessionCodec = (secret: string, now: () => Date): SessionCodec => {
  const mac = (payload: string) =>
    createHmac("sha256", secret).update(payload).digest("base64url");
  const nowSeconds = () => Math.floor(now().getTime() / 1000);

  return {
    sign(userId) {
      const payload: SessionPayload = { userId, exp: nowSeconds() + SESSION_TTL_SECONDS };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${encoded}.${mac(encoded)}`;
    },

    verify(token) {
      if (typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length !== 2) return null;
      const [encoded, signature] = parts as [string, string];

      const expected = Buffer.from(mac(encoded));
      const given = Buffer.from(signature);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

      try {
        const parsed = SessionPayloadSchema.safeParse(
          JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
        );
        if (!parsed.success || parsed.data.exp <= nowSeconds()) return null;
        return parsed.data;
      } catch {
        return null;
      }
    },
  };
};
