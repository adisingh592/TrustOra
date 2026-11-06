import type { PrismaClient } from "@prisma/client";
import {
  type EscrowAdapter,
  type EvaluationAdapter,
  type IntegrationHealth,
  type IntegrationStatus,
  PublicProjectIdSchema,
} from "@trustora/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../auth/routes.js";
import { buildUnifiedTrustReport } from "../trustreport/report.js";

export interface InfrastructureRouteDeps {
  prisma: PrismaClient;
  chainAdapter?: EscrowAdapter | null;
  evaluationAdapter?: EvaluationAdapter | null;
  now: () => Date;
}

export const infrastructureRoutes = async (app: FastifyInstance, deps: InfrastructureRouteDeps) => {
  const { prisma, chainAdapter, evaluationAdapter, now } = deps;

  // In-memory cache for infrastructure health (5-second TTL)
  let cachedInfra: { data: unknown; expiresAt: number } | null = null;

  /* -------------------------------------------------------------------------- */
  /* GET /infrastructure                                                        */
  /* -------------------------------------------------------------------------- */
  app.get("/infrastructure", async (_request, reply: FastifyReply) => {
    const currentTime = Date.now();
    if (cachedInfra && cachedInfra.expiresAt > currentTime) {
      return reply.send(cachedInfra.data);
    }

    let arcHealth: IntegrationHealth = {
      status: "NOT_CONFIGURED",
      detail: "No Arc chain adapter configured.",
      checkedAt: now().toISOString(),
    };

    if (chainAdapter) {
      try {
        arcHealth = await chainAdapter.health();
      } catch (err) {
        arcHealth = {
          status: "BLOCKED",
          detail: "Arc chain adapter health check failed.",
          checkedAt: now().toISOString(),
        };
      }
    }

    let zeroGHealth: IntegrationHealth = {
      status: "NOT_CONFIGURED",
      detail: "No 0G AI evaluation adapter configured.",
      checkedAt: now().toISOString(),
    };

    if (evaluationAdapter) {
      try {
        zeroGHealth = await evaluationAdapter.health();
      } catch (err) {
        zeroGHealth = {
          status: "BLOCKED",
          detail: "0G evaluation adapter health check failed.",
          checkedAt: now().toISOString(),
        };
      }
    }

    const hederaHealth: IntegrationHealth = {
      status: "NOT_CONFIGURED" as IntegrationStatus,
      detail: "Agent payments off in this demo (stretch goal).",
      checkedAt: now().toISOString(),
    };

    const response = {
      arc: arcHealth,
      zeroG: zeroGHealth,
      hedera: hederaHealth,
      timestamp: now().toISOString(),
    };

    cachedInfra = { data: response, expiresAt: currentTime + 5_000 };
    return reply.send(response);
  });

  /* -------------------------------------------------------------------------- */
  /* GET /ready                                                                 */
  /* -------------------------------------------------------------------------- */
  app.get("/ready", async (_request, reply: FastifyReply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.code(503).send({
        ok: false,
        database: "disconnected",
        timestamp: now().toISOString(),
      });
    }

    return reply.send({
      ok: true,
      database: "connected",
      timestamp: now().toISOString(),
    });
  });

  /* -------------------------------------------------------------------------- */
  /* GET /verify/:publicProjectId (Public Audit View)                           */
  /* -------------------------------------------------------------------------- */
  app.get<{ Params: { publicProjectId: string } }>(
    "/verify/:publicProjectId",
    async (request, reply: FastifyReply) => {
      const parsedId = PublicProjectIdSchema.safeParse(request.params.publicProjectId);
      if (!parsedId.success) {
        return sendError(reply, 404, "NOT_FOUND", "Project was not found.");
      }
      const publicProjectId = parsedId.data;

      const project = await prisma.project.findUnique({
        where: { publicProjectId },
        include: {
          milestones: {
            include: {
              agreementVersions: { orderBy: { version: "desc" }, take: 1 },
              submissions: {
                orderBy: { submittedAt: "desc" },
                take: 1,
                include: { evaluations: { orderBy: { createdAt: "desc" }, take: 1 } },
              },
            },
            orderBy: [{ deadline: "asc" }, { id: "asc" }],
          },
        },
      });

      if (!project) {
        return sendError(reply, 404, "NOT_FOUND", "Project was not found.");
      }

      // Fetch all ProofTrack events for this project in deterministic order
      const events = await prisma.proofEvent.findMany({
        where: { publicProjectId },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });

      // Compute sanitized public milestones
      const milestones = project.milestones.map((m) => {
        let criteria: string[] = [];
        const latestVer = m.agreementVersions[0];
        if (latestVer) {
          try {
            const parsed = JSON.parse(latestVer.criteriaJson);
            const matching = parsed.milestones?.find(
              (item: { onchainMilestoneId?: string }) => item.onchainMilestoneId === m.onchainMilestoneId,
            );
            criteria = matching?.criteria ?? [];
          } catch {
            criteria = [];
          }
        }

        const latestSubmission = m.submissions[0];
        const latestEvaluation = latestSubmission?.evaluations[0];

        return {
          id: m.id,
          onchainMilestoneId: m.onchainMilestoneId,
          title: m.title,
          amountBaseUnits: m.amountBaseUnits,
          tokenAddress: m.tokenAddress,
          tokenDecimals: m.tokenDecimals,
          deadline: m.deadline.toISOString(),
          status: m.status,
          criteria,
          deliverableSubmitted: Boolean(latestSubmission),
          deliverableSha256: latestSubmission?.fileHash ?? null,
          evaluationStatus: latestEvaluation?.status ?? null,
        };
      });

      // Build safe public timeline (no sensitive internal fields or private files)
      const proofTimeline = events.map((ev) => ({
        eventType: ev.eventType,
        occurredAt: ev.occurredAt.toISOString(),
        ecosystem: ev.ecosystem,
        network: ev.network,
        chainId: ev.chainId,
        referenceType: ev.referenceType,
        referenceValue: ev.referenceValue,
        verificationStatus: ev.verificationStatus,
        verifiedAt: ev.verifiedAt?.toISOString() ?? null,
        explorerUrl: ev.explorerUrl,
        summary: ev.summary,
        statusReason: ev.statusReason,
      }));

      // Optional Unified Trust Report summary
      let trustReportSummary = null;
      try {
        const trustReport = await buildUnifiedTrustReport({
          publicProjectId,
          paymentMode: (project.paymentMode ?? "ARC_ESCROW") as any,
          projectStatus: project.status as any,
          milestones: project.milestones as any,
          events: events as any,
          now,
        });
        trustReportSummary = {
          verifiableReportHash: trustReport.verifiableReportHash,
          trustShieldOverallRisk: trustReport.trustShield.overallRisk,
          proofTrackTotalEvents: trustReport.proofTrack.totalEvents,
          proofTrackVerifiedEvents: trustReport.proofTrack.verifiedEvents,
          generatedAt: trustReport.generatedAt,
        };
      } catch {
        // Safe fallback if report cannot be compiled
      }

      return reply.send({
        publicProjectId: project.publicProjectId,
        title: project.title,
        description: project.description,
        status: project.status,
        paymentMode: project.paymentMode ?? "ARC_ESCROW",
        createdAt: project.createdAt.toISOString(),
        milestones,
        proofTimeline,
        trustReport: trustReportSummary,
      });
    },
  );
};
