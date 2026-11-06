import type { PrismaClient } from "@prisma/client";
import { buildAnchorPayload, createArkivAnchorVerifier } from "@trustora/arkiv";
import { createProofTrack, verifierKey } from "@trustora/prooftrack";
import {
  type AnchorAdapter,
  AnchorError,
  type Ecosystem,
  PublicProjectIdSchema,
} from "@trustora/shared";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { createPrismaEventStore } from "./store.js";

const ANCHOR_INTERVAL_MS = 10_000;
const EventIdSchema = z.string().min(1).max(100);

/**
 * Sources that may not be anchored even when marked VERIFIED. ZERO_G: no independent
 * check exists for inference requests, so VERIFIED there is not a checked claim.
 * ARKIV: anchoring an anchor proves nothing new.
 */
const NOT_ANCHORABLE: readonly Ecosystem[] = ["ZERO_G", "ARKIV"];

export interface AnchorRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  /** Undefined when Arkiv is disabled or not configured. */
  anchorAdapter: AnchorAdapter | undefined;
  now: () => Date;
}

/**
 * The one route that records an event from a request, and only from a source event
 * our server already checked: nothing in the request becomes part of the record.
 * Arkiv is optional evidence. Nothing here touches escrow, submission or evaluation.
 */
export const anchorRoutes = async (app: FastifyInstance, deps: AnchorRouteDeps) => {
  const { prisma, requireUser, anchorAdapter, now } = deps;
  const store = createPrismaEventStore(prisma);
  const proofTrack = createProofTrack({ store, now });
  const lastRunAt = new Map<string, number>();

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  const takeSlot = (publicProjectId: string) => {
    const current = now().getTime();
    for (const [id, at] of lastRunAt) {
      if (current - at >= ANCHOR_INTERVAL_MS) lastRunAt.delete(id);
    }
    if (lastRunAt.has(publicProjectId)) return false;
    lastRunAt.set(publicProjectId, current);
    return true;
  };

  const verifiers = anchorAdapter
    ? new Map([
        [
          verifierKey({ ecosystem: "ARKIV", referenceType: "STORAGE_REFERENCE" }),
          createArkivAnchorVerifier({ adapter: anchorAdapter, getEvent: store.getById, now }),
        ],
      ])
    : new Map();

  const itemFor = async (publicProjectId: string, eventId: string) =>
    (await proofTrack.getTimeline(publicProjectId)).find((item) => item.id === eventId);

  app.post<{ Params: { id: string; eventId: string } }>(
    "/projects/:id/prooftrack/events/:eventId/anchor",
    async (request, reply) => {
      const { id, eventId } = request.params;
      const userId = request.userId ?? "";
      const project = PublicProjectIdSchema.safeParse(id).success
        ? await prisma.project.findFirst({
            where: { publicProjectId: id, OR: [{ clientId: userId }, { freelancerId: userId }] },
            select: { id: true },
          })
        : null;
      if (!project) return sendError(reply, 404, "NOT_FOUND", "This project was not found.");

      if (!anchorAdapter) {
        return sendError(reply, 501, "ARKIV_NOT_ENABLED", "Arkiv anchoring is not enabled on this server.");
      }

      const parsedEventId = EventIdSchema.safeParse(eventId);
      const source = parsedEventId.success ? await store.getById(parsedEventId.data) : null;
      if (!source || source.publicProjectId !== id) {
        return sendError(reply, 404, "NOT_FOUND", "This event was not found.");
      }
      if (source.verificationStatus !== "VERIFIED" || NOT_ANCHORABLE.includes(source.ecosystem)) {
        return sendError(
          reply,
          409,
          "SOURCE_NOT_VERIFIED",
          "Only an event our server has independently verified can be anchored.",
        );
      }

      if (!takeSlot(id)) {
        return sendError(
          reply,
          429,
          "RATE_LIMITED",
          "An anchor was requested for this project a moment ago. Please wait 10 seconds and try again.",
        );
      }

      const events = await store.listByProject(id);
      const existing = events.find(
        (event) => event.eventType === "EVIDENCE_ANCHORED" && event.expected.sourceEventId === source.id,
      );
      if (existing) {
        return reply.send({
          projectId: id,
          sourceEventId: source.id,
          alreadyAnchored: true,
          anchor: await itemFor(id, existing.id),
        });
      }

      let published;
      try {
        published = await anchorAdapter.publishAnchor(buildAnchorPayload(source));
      } catch (error) {
        request.log.warn(
          { anchorErrorCode: error instanceof AnchorError ? error.code : "UNEXPECTED" },
          "anchor publish failed",
        );
        return sendError(
          reply,
          503,
          "ANCHOR_UNAVAILABLE",
          "The public anchor could not be written right now. Nothing was recorded. Please try again later.",
        );
      }

      const recorded = await proofTrack.recordEvent({
        publicProjectId: id,
        ...(source.milestoneId ? { milestoneId: source.milestoneId } : {}),
        occurredAt: now().toISOString(),
        ecosystem: "ARKIV",
        network: anchorAdapter.network,
        eventType: "EVIDENCE_ANCHORED",
        referenceType: "STORAGE_REFERENCE",
        referenceValue: published.entityKey,
        expected: { sourceEventId: source.id, anchorExpiresAt: published.expiresAt },
      });
      await proofTrack.verifyEvent(recorded.id, verifiers);

      return reply.code(201).send({
        projectId: id,
        sourceEventId: source.id,
        alreadyAnchored: false,
        anchor: await itemFor(id, recorded.id),
      });
    },
  );
};
