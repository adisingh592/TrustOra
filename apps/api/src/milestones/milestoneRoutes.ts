import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  FundingProofBodySchema,
  ReleaseProofBodySchema,
  SubmitProofBodySchema,
  type EscrowAdapter,
  type EscrowState,
  type VerifiedChainEvent,
} from "@trustora/shared";
import { createUploadValidator } from "@trustora/security";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";

const sameHex = (a: string | undefined, b: string | undefined) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");

export interface MilestoneRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  chainAdapter: EscrowAdapter | null;
  storageDir?: string;
  now: () => Date;
}

export const milestoneRoutes = async (app: FastifyInstance, deps: MilestoneRouteDeps) => {
  const { prisma, requireUser, chainAdapter, now } = deps;
  const storageDir = deps.storageDir ?? join(process.cwd(), ".storage");

  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }

  const uploadValidator = createUploadValidator();

  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  /* -------------------------------------------------------------------------- */
  /* 1. FUNDING PROOF                                                           */
  /* -------------------------------------------------------------------------- */
  app.post<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/funding-proof",
    async (request, reply) => {
      const { id: publicProjectId, milestoneId } = request.params;
      const userId = request.userId!;

      const body = FundingProofBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return sendError(reply, 400, "INVALID_INPUT", "A valid 0x 64-hex transaction hash is required.");
      }
      const { txHash } = body.data;

      // Participant only (client or freelancer). Arbiter / outsider cannot fund.
      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          OR: [{ clientId: userId }, { freelancerId: userId }],
        },
        include: {
          client: true,
          freelancer: true,
          milestones: { where: { id: milestoneId } },
        },
      });

      if (!project || project.milestones.length === 0) {
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found.");
      }

      const milestone = project.milestones[0]!;

      // Idempotency: if already funded with the same transaction hash, succeed cleanly
      if (milestone.status === "FUNDED" || milestone.status === "WORK_SUBMITTED" || milestone.status === "RELEASED") {
        const existingEvent = await prisma.proofEvent.findFirst({
          where: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            eventType: "MILESTONE_FUNDED",
          },
        });
        if (existingEvent && existingEvent.referenceValue.toLowerCase() === txHash.toLowerCase()) {
          return reply.send({
            ok: true,
            milestoneId: milestone.id,
            status: milestone.status,
            alreadyProcessed: true,
          });
        }
        return sendError(reply, 400, "MILESTONE_ALREADY_FUNDED", "This milestone is already funded.");
      }

      // Terms must be agreed before funding
      if (milestone.status !== "AGREED") {
        return sendError(
          reply,
          400,
          "MILESTONE_NOT_AGREED",
          "Both parties must accept the milestone agreement before funding escrow.",
        );
      }

      // Chain adapter checks
      if (!chainAdapter) {
        return sendError(reply, 503, "ESCROW_NOT_CONFIGURED", "Escrow chain adapter is not configured.");
      }
      const adapterConfig = chainAdapter.getConfig();
      if (!adapterConfig.escrowAddress) {
        return sendError(reply, 503, "ESCROW_NOT_CONFIGURED", "Escrow contract address is not configured.");
      }
      if (!adapterConfig.tokenAddress) {
        return sendError(reply, 503, "TOKEN_NOT_CONFIGURED", "USDC token address is not configured.");
      }

      // Read active accepted agreement version
      const activeVersion = await prisma.agreementVersion.findFirst({
        where: {
          milestoneId: milestone.id,
          clientAcceptedAt: { not: null },
          freelancerAcceptedAt: { not: null },
        },
        orderBy: { version: "desc" },
      });

      if (!activeVersion) {
        return sendError(reply, 400, "NO_AGREED_VERSION", "No agreed agreement version exists for this milestone.");
      }

      // Independent chain verification (verifyFunding + readEscrow)
      let chainEvent: VerifiedChainEvent;
      let escrowState: EscrowState;
      try {
        [chainEvent, escrowState] = await Promise.all([
          chainAdapter.verifyFunding(milestone.onchainMilestoneId, txHash),
          chainAdapter.readEscrow(milestone.onchainMilestoneId),
        ]);
      } catch {
        return sendError(
          reply,
          503,
          "CHAIN_UNAVAILABLE",
          "The escrow blockchain is temporarily unreachable. Please retry.",
        );
      }

      // Fail-closed checks against stored milestone & accepted agreement
      const isEventValid =
        chainEvent.verified === true &&
        chainEvent.chainId === adapterConfig.chainId &&
        chainEvent.contractAddress.toLowerCase() === adapterConfig.escrowAddress.toLowerCase() &&
        sameHex(chainEvent.milestoneId, milestone.onchainMilestoneId) &&
        chainEvent.amount === milestone.amountBaseUnits &&
        chainEvent.token.toLowerCase() === milestone.tokenAddress.toLowerCase() &&
        sameHex(chainEvent.agreementHash, activeVersion.agreementHash);

      const isEscrowValid =
        (escrowState.status === "FUNDED" || escrowState.status === "AGREED") &&
        escrowState.amount === milestone.amountBaseUnits &&
        escrowState.token.toLowerCase() === milestone.tokenAddress.toLowerCase() &&
        sameHex(escrowState.agreementHash, activeVersion.agreementHash);

      if (!isEventValid || !isEscrowValid) {
        return sendError(
          reply,
          400,
          "FUNDING_MISMATCH",
          "On-chain funding transaction does not match this milestone terms, amount, or agreement hash.",
        );
      }

      // Update milestone and record ProofTrack event
      await prisma.$transaction(async (tx) => {
        await tx.milestone.update({
          where: { id: milestone.id },
          data: { status: "FUNDED" },
        });

        await tx.project.update({
          where: { id: project.id },
          data: { status: "FUNDED" },
        });

        const explorerUrl = adapterConfig.explorerBase
          ? `${adapterConfig.explorerBase}/tx/${txHash}`
          : undefined;

        await tx.proofEvent.create({
          data: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            occurredAt: now(),
            ecosystem: "ARC",
            network: "Arc Testnet",
            chainId: adapterConfig.chainId,
            eventType: "MILESTONE_FUNDED",
            referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
            referenceValue: txHash,
            verificationStatus: "VERIFIED",
            verifiedAt: now(),
            explorerUrl,
            summary: `Milestone "${milestone.title}" funded with ${milestone.amountBaseUnits} base units on Arc Testnet`,
            statusReason: "Verified against transaction receipt and escrow state",
            expectedJson: JSON.stringify({
              onchainMilestoneId: milestone.onchainMilestoneId,
              amountBaseUnits: milestone.amountBaseUnits,
              tokenAddress: milestone.tokenAddress,
              agreementHash: activeVersion.agreementHash,
              freelancerWallet: project.freelancer?.walletAddress,
            }),
          },
        });
      });

      return reply.send({
        ok: true,
        milestoneId: milestone.id,
        status: "FUNDED",
        txHash,
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 2. DELIVERABLE UPLOAD (Freelancer Only, Multipart)                         */
  /* -------------------------------------------------------------------------- */
  app.post<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/deliverable",
    async (request, reply) => {
      const { id: publicProjectId, milestoneId } = request.params;
      const userId = request.userId!;

      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          freelancerId: userId,
        },
        include: {
          milestones: { where: { id: milestoneId } },
        },
      });

      if (!project || project.milestones.length === 0) {
        return sendError(
          reply,
          404,
          "NOT_FOUND",
          "This milestone was not found, or you are not the assigned freelancer.",
        );
      }

      const milestone = project.milestones[0]!;

      // Milestone must be FUNDED or WORK_SUBMITTED
      if (milestone.status !== "FUNDED" && milestone.status !== "WORK_SUBMITTED") {
        return sendError(
          reply,
          400,
          "MILESTONE_NOT_FUNDED",
          "Deliverables can only be submitted after milestone escrow is funded.",
        );
      }

      const data = await request.file();
      if (!data) {
        return sendError(reply, 400, "MISSING_FILE", "Please upload a deliverable file.");
      }

      const bytes = await data.toBuffer();
      const claimedMime = data.mimetype;
      const fileName = data.filename;

      // Extract aiConsent from fields if present
      const aiConsentField = (data.fields.aiConsent as { value?: string } | undefined)?.value;
      const aiConsent = aiConsentField === "true" || aiConsentField === "1";

      const validation = uploadValidator.validate({
        name: fileName,
        claimedMime,
        bytes: new Uint8Array(bytes),
      });

      if (!validation.ok) {
        return sendError(reply, 400, "INVALID_UPLOAD", validation.reason);
      }

      // Store file privately outside web root
      const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
      const storageFileName = `deliv_${randomUUID()}${extension}`;
      const privateFilePath = join(storageDir, storageFileName);

      await writeFile(privateFilePath, bytes);

      // Find latest accepted agreement version
      const agreementVersion = await prisma.agreementVersion.findFirst({
        where: { milestoneId: milestone.id },
        orderBy: { version: "desc" },
      });

      if (!agreementVersion) {
        return sendError(reply, 400, "NO_AGREEMENT", "No agreement version exists for this milestone.");
      }

      // Record Submission
      const submission = await prisma.submission.create({
        data: {
          milestoneId: milestone.id,
          freelancerId: userId,
          agreementVersionId: agreementVersion.id,
          privateFilePath,
          fileHash: validation.sha256,
          aiConsent,
          aiConsentAt: aiConsent ? now() : null,
          status: "UPLOADED",
          submittedAt: now(),
        },
      });

      return reply.send({
        ok: true,
        submissionId: submission.id,
        fileHash: validation.sha256,
        size: validation.size,
        aiConsent,
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 3. DELIVERABLE DOWNLOAD (Private Authorized Access)                        */
  /* -------------------------------------------------------------------------- */
  app.get<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/deliverable",
    async (request, reply) => {
      const { id: publicProjectId, milestoneId } = request.params;
      const userId = request.userId!;

      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          OR: [{ clientId: userId }, { freelancerId: userId }, { arbiterId: userId }],
        },
        include: {
          milestones: {
            where: { id: milestoneId },
            include: {
              submissions: { orderBy: { submittedAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (!project || project.milestones.length === 0) {
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found.");
      }

      const milestone = project.milestones[0]!;
      const submission = milestone.submissions[0];

      if (!submission) {
        return sendError(reply, 404, "NO_SUBMISSION", "No deliverable has been uploaded for this milestone.");
      }

      if (!existsSync(submission.privateFilePath)) {
        return sendError(reply, 404, "FILE_NOT_FOUND", "Deliverable file could not be found on server storage.");
      }

      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", `attachment; filename="deliverable-${milestone.id}.bin"`);
      return reply.send(createReadStream(submission.privateFilePath));
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 4. SUBMIT PROOF (Freelancer Only, txHash Verification)                     */
  /* -------------------------------------------------------------------------- */
  app.post<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/submit-proof",
    async (request, reply) => {
      const { id: publicProjectId, milestoneId } = request.params;
      const userId = request.userId!;

      const body = SubmitProofBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return sendError(reply, 400, "INVALID_INPUT", "A valid 0x 64-hex transaction hash is required.");
      }
      const { txHash } = body.data;

      // Freelancer only
      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          freelancerId: userId,
        },
        include: {
          milestones: {
            where: { id: milestoneId },
            include: {
              submissions: { orderBy: { submittedAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (!project || project.milestones.length === 0) {
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found, or you are not the freelancer.");
      }

      const milestone = project.milestones[0]!;
      const submission = milestone.submissions[0];

      if (!submission) {
        return sendError(
          reply,
          400,
          "NO_SUBMISSION",
          "Deliverable file must be uploaded before submitting on-chain work proof.",
        );
      }

      // Idempotency: if already WORK_SUBMITTED with the same transaction hash, succeed
      if (milestone.status === "WORK_SUBMITTED" || milestone.status === "RELEASED") {
        const existingEvent = await prisma.proofEvent.findFirst({
          where: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            eventType: "WORK_SUBMITTED",
          },
        });
        if (existingEvent && existingEvent.referenceValue.toLowerCase() === txHash.toLowerCase()) {
          return reply.send({
            ok: true,
            milestoneId: milestone.id,
            status: milestone.status,
            alreadyProcessed: true,
          });
        }
      }

      if (milestone.status !== "FUNDED" && milestone.status !== "WORK_SUBMITTED") {
        return sendError(reply, 400, "NOT_FUNDED", "Milestone must be funded before submitting work proof.");
      }

      if (!chainAdapter) {
        return sendError(reply, 503, "ESCROW_NOT_CONFIGURED", "Escrow chain adapter is not configured.");
      }
      const adapterConfig = chainAdapter.getConfig();

      // Read escrow state and verify deliverableHash equals uploaded file SHA-256
      let escrowState: EscrowState;
      try {
        escrowState = await chainAdapter.readEscrow(milestone.onchainMilestoneId);
      } catch {
        return sendError(reply, 503, "CHAIN_UNAVAILABLE", "Escrow blockchain is temporarily unavailable.");
      }

      if (!sameHex(escrowState.deliverableHash, submission.fileHash)) {
        return sendError(
          reply,
          400,
          "DELIVERABLE_HASH_MISMATCH",
          "On-chain deliverable hash does not match the uploaded file SHA-256 hash.",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.milestone.update({
          where: { id: milestone.id },
          data: { status: "WORK_SUBMITTED" },
        });

        await tx.submission.update({
          where: { id: submission.id },
          data: { status: "SUBMITTED" },
        });

        const explorerUrl = adapterConfig.explorerBase
          ? `${adapterConfig.explorerBase}/tx/${txHash}`
          : undefined;

        await tx.proofEvent.create({
          data: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            occurredAt: now(),
            ecosystem: "ARC",
            network: "Arc Testnet",
            chainId: adapterConfig.chainId,
            eventType: "WORK_SUBMITTED",
            referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
            referenceValue: txHash,
            verificationStatus: "VERIFIED",
            verifiedAt: now(),
            explorerUrl,
            summary: `Work deliverable submitted on Arc with SHA-256 ${submission.fileHash.slice(0, 16)}...`,
            statusReason: "Verified on-chain deliverable hash against uploaded file hash",
            expectedJson: JSON.stringify({
              onchainMilestoneId: milestone.onchainMilestoneId,
              deliverableSha256: submission.fileHash,
            }),
          },
        });
      });

      return reply.send({
        ok: true,
        milestoneId: milestone.id,
        status: "WORK_SUBMITTED",
        txHash,
      });
    },
  );

  /* -------------------------------------------------------------------------- */
  /* 5. RELEASE PROOF (Client or Arbiter Only)                                 */
  /* -------------------------------------------------------------------------- */
  app.post<{ Params: { id: string; milestoneId: string } }>(
    "/projects/:id/milestones/:milestoneId/release-proof",
    async (request, reply) => {
      const { id: publicProjectId, milestoneId } = request.params;
      const userId = request.userId!;

      const body = ReleaseProofBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return sendError(reply, 400, "INVALID_INPUT", "A valid 0x 64-hex transaction hash is required.");
      }
      const { txHash } = body.data;

      // Client or Arbiter only
      const project = await prisma.project.findFirst({
        where: {
          publicProjectId,
          OR: [{ clientId: userId }, { arbiterId: userId }],
        },
        include: {
          client: true,
          freelancer: true,
          arbiter: true,
          milestones: { where: { id: milestoneId } },
        },
      });

      if (!project || project.milestones.length === 0) {
        // If caller was the freelancer, give a clear refusal
        const isFreelancer = await prisma.project.findFirst({
          where: { publicProjectId, freelancerId: userId },
        });
        if (isFreelancer) {
          return sendError(reply, 403, "FORBIDDEN", "Freelancers cannot release escrow funds to themselves.");
        }
        return sendError(reply, 404, "NOT_FOUND", "This milestone was not found.");
      }

      const milestone = project.milestones[0]!;

      // Idempotency: if already RELEASED with same txHash, succeed
      if (milestone.status === "RELEASED") {
        const existingEvent = await prisma.proofEvent.findFirst({
          where: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            eventType: "PAYMENT_RELEASED",
          },
        });
        if (existingEvent && existingEvent.referenceValue.toLowerCase() === txHash.toLowerCase()) {
          return reply.send({
            ok: true,
            milestoneId: milestone.id,
            status: "RELEASED",
            alreadyProcessed: true,
          });
        }
      }

      if (milestone.status !== "WORK_SUBMITTED" && milestone.status !== "RELEASED") {
        return sendError(
          reply,
          400,
          "MILESTONE_NOT_SUBMITTED",
          "Deliverables must be submitted before approving milestone and releasing escrow.",
        );
      }

      if (!chainAdapter) {
        return sendError(reply, 503, "ESCROW_NOT_CONFIGURED", "Escrow chain adapter is not configured.");
      }
      const adapterConfig = chainAdapter.getConfig();

      let chainEvent: VerifiedChainEvent;
      let escrowState: EscrowState;
      try {
        [chainEvent, escrowState] = await Promise.all([
          chainAdapter.verifyRelease(milestone.onchainMilestoneId, txHash),
          chainAdapter.readEscrow(milestone.onchainMilestoneId),
        ]);
      } catch {
        return sendError(reply, 503, "CHAIN_UNAVAILABLE", "Escrow blockchain is temporarily unavailable.");
      }

      const isReleaseValid =
        chainEvent.verified === true &&
        chainEvent.chainId === adapterConfig.chainId &&
        chainEvent.contractAddress.toLowerCase() === adapterConfig.escrowAddress.toLowerCase() &&
        sameHex(chainEvent.milestoneId, milestone.onchainMilestoneId) &&
        chainEvent.amount === milestone.amountBaseUnits &&
        chainEvent.token.toLowerCase() === milestone.tokenAddress.toLowerCase() &&
        escrowState.status === "RELEASED";

      if (!isReleaseValid) {
        return sendError(
          reply,
          400,
          "RELEASE_MISMATCH",
          "On-chain release transaction does not match this milestone or status is not RELEASED.",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.milestone.update({
          where: { id: milestone.id },
          data: { status: "RELEASED" },
        });

        // Check if all milestones for project are released
        const remaining = await tx.milestone.count({
          where: { projectId: project.id, status: { not: "RELEASED" } },
        });
        if (remaining === 0) {
          await tx.project.update({
            where: { id: project.id },
            data: { status: "COMPLETED" },
          });
        }

        const explorerUrl = adapterConfig.explorerBase
          ? `${adapterConfig.explorerBase}/tx/${txHash}`
          : undefined;

        // Record MILESTONE_APPROVED
        await tx.proofEvent.create({
          data: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            occurredAt: now(),
            ecosystem: "ARC",
            network: "Arc Testnet",
            chainId: adapterConfig.chainId,
            eventType: "MILESTONE_APPROVED",
            referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
            referenceValue: txHash,
            verificationStatus: "VERIFIED",
            verifiedAt: now(),
            explorerUrl,
            summary: `Milestone "${milestone.title}" approved on Arc Testnet`,
            statusReason: "Verified against approve/release transaction",
            expectedJson: JSON.stringify({
              onchainMilestoneId: milestone.onchainMilestoneId,
            }),
          },
        });

        // Record PAYMENT_RELEASED
        await tx.proofEvent.create({
          data: {
            publicProjectId: project.publicProjectId,
            milestoneId: milestone.id,
            occurredAt: now(),
            ecosystem: "ARC",
            network: "Arc Testnet",
            chainId: adapterConfig.chainId,
            eventType: "PAYMENT_RELEASED",
            referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
            referenceValue: txHash,
            verificationStatus: "VERIFIED",
            verifiedAt: now(),
            explorerUrl,
            summary: `Payment of ${milestone.amountBaseUnits} base units released to freelancer on Arc Testnet`,
            statusReason: "Verified against transaction receipt and escrow state",
            expectedJson: JSON.stringify({
              onchainMilestoneId: milestone.onchainMilestoneId,
              amountBaseUnits: milestone.amountBaseUnits,
              tokenAddress: milestone.tokenAddress,
              freelancerWallet: project.freelancer?.walletAddress,
            }),
          },
        });
      });

      return reply.send({
        ok: true,
        milestoneId: milestone.id,
        status: "RELEASED",
        txHash,
      });
    },
  );
};
