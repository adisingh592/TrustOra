import type { StoredEvent } from "@trustora/prooftrack";
import { AnchorError, type AnchorPayload, AnchorPayloadSchema } from "@trustora/shared";
import { computeEventDigest } from "./digest.js";

const stripPrefix = (hex: string) => hex.toLowerCase().replace(/^0x/, "");

export const digestOfStoredEvent = (event: StoredEvent): string =>
  computeEventDigest({
    projectId: event.publicProjectId,
    type: event.eventType,
    ecosystem: event.ecosystem,
    referenceType: event.referenceType,
    reference: event.referenceValue,
    occurredAt: event.occurredAt.toISOString(),
  });

/**
 * The only thing ever written to Arkiv, which is public. Built field by field, so
 * nothing else on the event can reach it, then checked against a strict schema.
 */
export const buildAnchorPayload = (source: StoredEvent): AnchorPayload => {
  const subject = source.expected.agreementHash ?? source.expected.deliverableSha256;
  const parsed = AnchorPayloadSchema.safeParse({
    projectId: source.publicProjectId,
    eventType: source.eventType,
    eventDigest: digestOfStoredEvent(source),
    ...(subject ? { subjectDigest: stripPrefix(subject) } : {}),
    network: source.network,
    reference: source.referenceValue,
    occurredAt: source.occurredAt.toISOString(),
  });
  if (!parsed.success) throw new AnchorError("INVALID_PAYLOAD");
  return parsed.data;
};
