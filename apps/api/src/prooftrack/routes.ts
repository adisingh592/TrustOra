import type { PrismaClient } from "@prisma/client";
import {
  createChainVerifier,
  createProofTrack,
  verifierKey,
  type Verifiers,
} from "@trustora/prooftrack";
import { type EscrowAdapter, PublicProjectIdSchema } from "@trustora/shared";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { createPrismaEventStore } from "./store.js";

const VERIFY_INTERVAL_MS = 10_000;

const EventIdSchema = z.string().min(1).max(100);

/**
 * Only chain transactions have a check. There is deliberately no ZERO_G entry: no
 * independent check exists for inference requests yet, so they stay PENDING.
 */
export const buildVerifiers = (chainAdapter: EscrowAdapter | null): Verifiers =>
  chainAdapter
    ? new Map([
        [
          verifierKey({ ecosystem: "ARC", referenceType: "BLOCKCHAIN_TRANSACTION_HASH" }),
          createChainVerifier(chainAdapter),
        ],
      ])
    : new Map();

export interface ProofTrackRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  /** Null until a real chain adapter is configured: events then stay PENDING. */
  chainAdapter: EscrowAdapter | null;
  now: () => Date;
}

/** Reads and re-checks only. There is no route that creates an event. */
export const proofTrackRoutes = async (app: FastifyInstance, deps: ProofTrackRouteDeps) => {
  const { prisma, requireUser, chainAdapter, now } = deps;
  const store = createPrismaEventStore(prisma);
  const proofTrack = createProofTrack({ store, now });
  const verifiers = buildVerifiers(chainAdapter);
  const lastRunAt = new Map<string, number>();

  // onRequest, so an unauthenticated caller learns nothing, even about bad input.
  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  const notFound = (reply: FastifyReply) =>
    sendError(reply, 404, "NOT_FOUND", "This project was not found.");

  const isParticipant = async (publicProjectId: string, userId: string | null) => {
    if (!PublicProjectIdSchema.safeParse(publicProjectId).success) return false;
    const project = await prisma.project.findFirst({
      where: {
        publicProjectId,
        OR: [{ clientId: userId ?? "" }, { freelancerId: userId ?? "" }],
      },
      select: { id: true },
    });
    return project !== null;
  };

  /** Shared by both verify routes, so one cannot be used to get around the other. */
  const takeVerifySlot = (publicProjectId: string) => {
    const current = now().getTime();
    for (const [id, at] of lastRunAt) {
      if (current - at >= VERIFY_INTERVAL_MS) lastRunAt.delete(id);
    }
    if (lastRunAt.has(publicProjectId)) return false;
    lastRunAt.set(publicProjectId, current);
    return true;
  };

  const rateLimited = (reply: FastifyReply) =>
    sendError(
      reply,
      429,
      "RATE_LIMITED",
      "This project was checked a moment ago. Please wait 10 seconds and try again.",
    );

  const timeline = async (publicProjectId: string, milestoneId?: string) => ({
    projectId: publicProjectId,
    events: await proofTrack.getTimeline(publicProjectId, milestoneId ? { milestoneId } : undefined),
  });

  app.get<{ Params: { id: string }; Querystring: { milestoneId?: string } }>(
    "/projects/:id/prooftrack",
    async (request, reply) => {
      if (!(await isParticipant(request.params.id, request.userId))) return notFound(reply);
      return timeline(request.params.id, request.query.milestoneId);
    },
  );

  app.post<{ Params: { id: string } }>("/projects/:id/prooftrack/verify", async (request, reply) => {
    if (!(await isParticipant(request.params.id, request.userId))) return notFound(reply);
    if (!takeVerifySlot(request.params.id)) return rateLimited(reply);
    await proofTrack.verifyProject(request.params.id, verifiers);
    return timeline(request.params.id);
  });

  app.post<{ Params: { id: string; eventId: string } }>(
    "/projects/:id/prooftrack/events/:eventId/verify",
    async (request, reply) => {
      const { id, eventId } = request.params;
      if (!(await isParticipant(id, request.userId))) return notFound(reply);

      const parsedEventId = EventIdSchema.safeParse(eventId);
      const event = parsedEventId.success ? await store.getById(parsedEventId.data) : null;
      if (!event || event.publicProjectId !== id) {
        return sendError(reply, 404, "NOT_FOUND", "This event was not found.");
      }
      if (!takeVerifySlot(id)) return rateLimited(reply);
      await proofTrack.verifyEvent(event.id, verifiers);
      return timeline(id);
    },
  );
};
