import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { computeTrustShieldReport } from "./trustshield.js";

export interface TrustShieldRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  now: () => Date;
}

export const trustShieldRoutes = async (app: FastifyInstance, deps: TrustShieldRouteDeps) => {
  const { prisma, requireUser, now } = deps;

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  app.get<{ Params: { id: string } }>("/projects/:id/trustshield", async (request, reply: FastifyReply) => {
    const publicProjectId = request.params.id;
    const userId = request.userId ?? "";

    const project = await prisma.project.findFirst({
      where: {
        publicProjectId,
        OR: [{ clientId: userId }, { freelancerId: userId }, { arbiterId: userId }],
      },
      include: {
        milestones: {
          include: {
            agreementVersions: { select: { version: true } },
            submissions: { select: { id: true, status: true, submittedAt: true } },
          },
        },
      },
    });

    if (!project) {
      return sendError(reply, 404, "NOT_FOUND", "This project was not found.");
    }

    const report = computeTrustShieldReport({
      publicProjectId,
      projectStatus: project.status,
      milestones: project.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        deadline: m.deadline,
        status: m.status,
        agreementVersions: m.agreementVersions,
        submissions: m.submissions,
      })),
      now: now(),
    });

    return reply.code(200).send(report);
  });
};
