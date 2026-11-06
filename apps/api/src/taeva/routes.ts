import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { EvaluationAdapter, TaevaEvaluationReport } from "@trustora/shared";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { runTaevaEvaluation } from "./taeva.js";

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface TaevaRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  evaluationAdapter?: EvaluationAdapter | null;
  now: () => Date;
}

export const taevaRoutes = async (app: FastifyInstance, deps: TaevaRouteDeps) => {
  const { prisma, requireUser, evaluationAdapter, now } = deps;

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  // POST /projects/:id/milestones/:milestoneId/evaluate
  app.post<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/evaluate",
    async (request, reply: FastifyReply) => {
      const publicProjectId = request.params.id;
      const milestoneId = request.params.milestoneId;
      const userId = request.userId ?? "";

      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          OR: [{ clientId: userId }, { freelancerId: userId }, { arbiterId: userId }],
        },
        include: {
          milestones: {
            where: {
              OR: [{ id: milestoneId }, { onchainMilestoneId: milestoneId }],
            },
            include: {
              agreementVersions: { orderBy: { version: "desc" }, take: 1 },
              submissions: { orderBy: { submittedAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (!project) {
        return sendError(reply, 404, "NOT_FOUND", "This project was not found.");
      }

      const milestone = project.milestones[0];
      if (!milestone) {
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found.");
      }

      const submission = milestone.submissions[0];
      if (!submission) {
        return sendError(
          reply,
          400,
          "NO_SUBMISSION",
          "Cannot evaluate milestone: no deliverable has been submitted yet.",
        );
      }

      const agreementVersion = milestone.agreementVersions[0];
      if (!agreementVersion) {
        return sendError(
          reply,
          400,
          "NO_AGREEMENT",
          "Cannot evaluate milestone: no agreement version found.",
        );
      }

      const report: TaevaEvaluationReport = await runTaevaEvaluation({
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        milestoneDeadline: milestone.deadline,
        onchainMilestoneId: milestone.onchainMilestoneId,
        submissionId: submission.id,
        submissionFileHash: submission.fileHash,
        submissionPrivateFilePath: submission.privateFilePath,
        submissionAiConsent: submission.aiConsent,
        submissionSubmittedAt: submission.submittedAt,
        agreementCriteriaJson: agreementVersion.criteriaJson,
        agreementClientAcceptedAt: agreementVersion.clientAcceptedAt,
        agreementFreelancerAcceptedAt: agreementVersion.freelancerAcceptedAt,
        evaluationAdapter,
      });

      // Persist Evaluation record
      await prisma.evaluation.create({
        data: {
          submissionId: submission.id,
          provider: "TAEVA",
          modelId: "taeva-advisory-v1",
          requestId: report.requestId,
          promptHash: sha256Hex(agreementVersion.criteriaJson),
          reportHash: report.reportHash,
          resultJson: JSON.stringify(report),
          status: report.overallStatus,
        },
      });

      // Record a ProofTrack event for evaluation completion (idempotent referenceType + referenceValue)
      const existingProof = await prisma.proofEvent.findFirst({
        where: {
          referenceType: "INFERENCE_REQUEST_ID",
          referenceValue: report.requestId,
          eventType: "EVALUATION_COMPLETED",
        },
      });

      if (!existingProof) {
        await prisma.proofEvent.create({
          data: {
            publicProjectId,
            milestoneId: milestone.id,
            occurredAt: now(),
            ecosystem: "ZERO_G",
            network: "0G Galileo",
            eventType: "EVALUATION_COMPLETED",
            referenceType: "INFERENCE_REQUEST_ID",
            referenceValue: report.requestId,
            verificationStatus: "VERIFIED",
            verifiedAt: now(),
            summary: `TAEVA advisory evaluation completed with status ${report.overallStatus}`,
            statusReason: report.explanation,
            expectedJson: JSON.stringify({
              deliverableSha256: submission.fileHash,
            }),
          },
        });
      }

      return reply.code(200).send(report);
    },
  );

  // GET /projects/:id/milestones/:milestoneId/evaluation
  app.get<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/evaluation",
    async (request, reply: FastifyReply) => {
      const publicProjectId = request.params.id;
      const milestoneId = request.params.milestoneId;
      const userId = request.userId ?? "";

      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          OR: [{ clientId: userId }, { freelancerId: userId }, { arbiterId: userId }],
        },
        include: {
          milestones: {
            where: {
              OR: [{ id: milestoneId }, { onchainMilestoneId: milestoneId }],
            },
            include: {
              submissions: {
                orderBy: { submittedAt: "desc" },
                take: 1,
                include: {
                  evaluations: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!project) {
        return sendError(reply, 404, "NOT_FOUND", "This project was not found.");
      }

      const milestone = project.milestones[0];
      if (!milestone) {
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found.");
      }

      const submission = milestone.submissions[0];
      const evaluation = submission?.evaluations[0];
      if (!evaluation) {
        return sendError(
          reply,
          404,
          "NO_EVALUATION",
          "No evaluation report exists for this milestone.",
        );
      }

      const report = JSON.parse(evaluation.resultJson) as TaevaEvaluationReport;
      return reply.code(200).send(report);
    },
  );
};
