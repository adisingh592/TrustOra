import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { computeScopeGuardReport, type VersionInfo } from "./scopeguard.js";

const QuerySchema = z.object({
  baseVersion: z.coerce.number().int().positive().optional(),
  targetVersion: z.coerce.number().int().positive().optional(),
});

export interface ScopeGuardRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
}

export const scopeGuardRoutes = async (app: FastifyInstance, deps: ScopeGuardRouteDeps) => {
  const { prisma, requireUser } = deps;

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  app.get<{ Params: { id: string } }>("/projects/:id/scopeguard", async (request, reply: FastifyReply) => {
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
            agreementVersions: {
              orderBy: { version: "asc" },
            },
          },
        },
      },
    });

    if (!project) {
      return sendError(reply, 404, "NOT_FOUND", "This project was not found.");
    }

    const query = QuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(reply, 400, "INVALID_INPUT", "Invalid version query parameters.");
    }

    // Collect unique agreement versions across milestones
    const versionMap = new Map<number, VersionInfo>();
    for (const milestone of project.milestones) {
      for (const av of milestone.agreementVersions) {
        if (!versionMap.has(av.version)) {
          versionMap.set(av.version, {
            version: av.version,
            criteriaJson: av.criteriaJson,
            clientAcceptedAt: av.clientAcceptedAt,
            freelancerAcceptedAt: av.freelancerAcceptedAt,
          });
        }
      }
    }

    const availableVersions = Array.from(versionMap.keys()).sort((a, b) => a - b);
    if (availableVersions.length === 0) {
      return sendError(reply, 404, "NO_AGREEMENT_VERSIONS", "No agreement versions found for this project.");
    }

    const maxVersion = availableVersions.at(-1)!;
    const targetVersion = query.data.targetVersion ?? maxVersion;

    // Base version defaults to targetVersion - 1 (or 1 if target is 1)
    let baseVersion = query.data.baseVersion;
    if (baseVersion === undefined) {
      baseVersion = targetVersion > 1 ? targetVersion - 1 : 1;
    }

    const baseInfo = versionMap.get(baseVersion);
    const targetInfo = versionMap.get(targetVersion);

    if (!baseInfo || !targetInfo) {
      return sendError(
        reply,
        400,
        "INVALID_VERSION",
        `Requested version(s) not found. Available versions: ${availableVersions.join(", ")}.`,
      );
    }

    const report = computeScopeGuardReport(publicProjectId, baseInfo, targetInfo);
    return reply.code(200).send(report);
  });
};
