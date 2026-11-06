import type { PrismaClient } from "@prisma/client";
import type {
  PaymentMode,
  ProjectStatus,
  ScopeGuardReport,
  TaevaEvaluationReport,
} from "@trustora/shared";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { computeScopeGuardReport } from "../scopeguard/scopeguard.js";
import { computeTrustShieldReport } from "../trustshield/trustshield.js";
import { buildUnifiedTrustReport } from "./report.js";

export interface TrustReportRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  now: () => Date;
}

export const trustReportRoutes = async (app: FastifyInstance, deps: TrustReportRouteDeps) => {
  const { prisma, requireUser, now } = deps;

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  app.get<{ Params: { id: string } }>("/projects/:id/trust-report", async (request, reply: FastifyReply) => {
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
            agreementVersions: { orderBy: { version: "asc" } },
            submissions: {
              orderBy: { submittedAt: "desc" },
              include: {
                evaluations: { orderBy: { createdAt: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return sendError(reply, 404, "NOT_FOUND", "This project was not found.");
    }

    const proofEvents = await prisma.proofEvent.findMany({
      where: { publicProjectId },
      select: { verificationStatus: true, ecosystem: true },
    });

    // 1. TAEVA evaluations
    const evaluations: TaevaEvaluationReport[] = [];
    for (const m of project.milestones) {
      const latestSub = m.submissions[0];
      const latestEval = latestSub?.evaluations[0];
      if (latestEval) {
        try {
          evaluations.push(JSON.parse(latestEval.resultJson) as TaevaEvaluationReport);
        } catch {
          // Ignore corrupt evaluation JSON
        }
      }
    }

    // 2. ScopeGuard version analysis
    const versionMap = new Map<number, {
      version: number;
      criteriaJson: string;
      clientAcceptedAt: Date | null;
      freelancerAcceptedAt: Date | null;
    }>();

    for (const m of project.milestones) {
      for (const av of m.agreementVersions) {
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

    const versions = Array.from(versionMap.values()).sort((a, b) => a.version - b.version);
    const totalVersions = versions.length || 1;
    const activeVersion =
      [...versions].reverse().find((v) => v.clientAcceptedAt !== null && v.freelancerAcceptedAt !== null)?.version ?? 1;

    const latestProposed = versions.at(-1);
    const hasPendingProposals =
      latestProposed !== undefined &&
      (latestProposed.clientAcceptedAt === null || latestProposed.freelancerAcceptedAt === null);

    let latestScopeChange: ScopeGuardReport | undefined;
    if (versions.length > 1) {
      const baseInfo = versions.find((v) => v.version === activeVersion) ?? versions[0]!;
      const targetInfo = versions.at(-1)!;
      if (baseInfo.version !== targetInfo.version) {
        latestScopeChange = computeScopeGuardReport(publicProjectId, baseInfo, targetInfo);
      }
    }

    // 3. TrustShield analysis
    const trustShieldReport = computeTrustShieldReport({
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

    const unifiedReport = buildUnifiedTrustReport({
      publicProjectId,
      paymentMode: (project.paymentMode as PaymentMode) ?? "ARC_ESCROW",
      projectStatus: project.status as ProjectStatus,
      now: now(),
      evaluations,
      totalMilestones: project.milestones.length,
      totalVersions,
      activeVersion,
      hasPendingProposals,
      latestScopeChange,
      trustShieldReport,
      proofTrackEvents: proofEvents,
    });

    return reply.code(200).send(unifiedReport);
  });
};
