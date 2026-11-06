import { randomInt, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AcceptAgreementBodySchema,
  ARC_TESTNET_CHAIN_ID,
  CreateProjectBodySchema,
  type MilestoneStatus,
  ProposeVersionBodySchema,
  PublicProjectIdSchema,
  USDC_DECIMALS,
} from "@trustora/shared";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import type { z } from "zod";
import { sendError, sendInternalError, statusOf } from "../auth/routes.js";
import { upsertUserByWallet } from "../auth/users.js";
import {
  type AgreementTerms,
  computeOnchainMilestoneId,
  hashAgreementTerms,
  type MilestoneTerms,
} from "./agreement.js";

const DRAFT: MilestoneStatus = "DRAFT";
const AGREED: MilestoneStatus = "AGREED";
/** Terms can only be renegotiated before any money moves. */
const NEGOTIABLE_STATUSES: readonly string[] = [DRAFT, AGREED];

const MAX_ID_ATTEMPTS = 5;
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

const PROJECT_INCLUDE = {
  client: true,
  freelancer: true,
  arbiter: true,
  milestones: {
    include: { agreementVersions: { orderBy: { version: "asc" } } },
    orderBy: [{ deadline: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ProjectInclude;

type LoadedProject = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

const newPublicProjectId = () =>
  `TRU-PROJ-2026-${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const invalidInput = (reply: FastifyReply, error: z.ZodError) => {
  const issue = error.issues[0];
  const field = issue?.path.join(".");
  const detail = issue ? `${field ? `${field} ` : ""}${issue.message}` : "is not valid";
  return sendError(reply, 400, "INVALID_INPUT", `The request is not valid: ${detail}.`);
};

const notFound = (reply: FastifyReply) =>
  sendError(reply, 404, "NOT_FOUND", "This project was not found.");

const latestVersionOf = (project: LoadedProject) =>
  Math.max(...project.milestones.flatMap((m) => m.agreementVersions.map((v) => v.version)));

const toResponse = (project: LoadedProject, userId: string) => {
  const latest = latestVersionOf(project);
  const rowsOf = (version: number) =>
    project.milestones.flatMap((m) => m.agreementVersions.filter((v) => v.version === version));
  const current = rowsOf(latest)[0]!;
  const terms = JSON.parse(current.criteriaJson) as AgreementTerms;
  const versions = Array.from({ length: latest }, (_, index) => {
    const row = rowsOf(index + 1)[0]!;
    return {
      version: row.version,
      agreementHash: row.agreementHash,
      clientAcceptedAt: row.clientAcceptedAt,
      freelancerAcceptedAt: row.freelancerAcceptedAt,
    };
  });

  return {
    id: project.publicProjectId,
    title: project.title,
    description: project.description,
    status: project.status,
    paymentMode: project.paymentMode ?? "ARC_ESCROW",
    role: project.clientId === userId ? "client" : "freelancer",
    clientWallet: project.client.walletAddress,
    freelancerWallet: project.freelancer?.walletAddress ?? null,
    arbiterWallet: project.arbiter?.walletAddress ?? null,
    createdAt: project.createdAt,
    agreement: versions.at(-1),
    versions,
    milestones: project.milestones.map((milestone) => ({
      id: milestone.id,
      onchainMilestoneId: milestone.onchainMilestoneId,
      title: milestone.title,
      amountBaseUnits: milestone.amountBaseUnits,
      tokenAddress: milestone.tokenAddress,
      tokenDecimals: milestone.tokenDecimals,
      deadline: milestone.deadline,
      status: milestone.status,
      criteria:
        terms.milestones.find((m) => m.onchainMilestoneId === milestone.onchainMilestoneId)
          ?.criteria ?? [],
    })),
  };
};

export interface ProjectRouteDeps {
  prisma: PrismaClient;
  requireUser: preHandlerAsyncHookHandler;
  /** Null when ARC_TESTNET_USDC_ADDRESS is not set. Never guessed. */
  tokenAddress: string | null;
  now: () => Date;
}

export const projectRoutes = async (app: FastifyInstance, deps: ProjectRouteDeps) => {
  const { prisma, requireUser, tokenAddress, now } = deps;

  // onRequest, so an unauthenticated caller learns nothing, even about bad input.
  app.addHook("onRequest", requireUser);

  app.setErrorHandler((error, request, reply) => {
    if (statusOf(error) < 500) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid.");
    }
    return sendInternalError(request, reply, error);
  });

  const loadForParticipant = (publicProjectId: string, userId: string) =>
    prisma.project.findFirst({
      where: { publicProjectId, OR: [{ clientId: userId }, { freelancerId: userId }] },
      include: PROJECT_INCLUDE,
    });

  const firstPastDeadline = (milestones: { deadline: string }[]) =>
    milestones.some((m) => new Date(m.deadline) <= now());

  /** Throwing rolls the transaction back and sends this response. */
  class Refusal extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  const refusalOr = (reply: FastifyReply, error: unknown) => {
    if (error instanceof Refusal) return sendError(reply, error.status, error.code, error.message);
    throw error;
  };

  /**
   * Takes the database write lock first, so the checks and writes in a transaction
   * cannot interleave with another request changing the same project.
   */
  const lockProject = (tx: Prisma.TransactionClient, projectId: string) =>
    tx.$executeRaw`UPDATE "Project" SET "status" = "status" WHERE "id" = ${projectId}`;

  app.post("/projects", async (request, reply) => {
    const body = CreateProjectBodySchema.safeParse(request.body);
    if (!body.success) return invalidInput(reply, body.error);
    const input = body.data;
    if (!tokenAddress && input.paymentMode === "ARC_ESCROW") {
      return sendError(
        reply,
        503,
        "TOKEN_NOT_CONFIGURED",
        "Projects cannot be created until the server's USDC address is configured.",
      );
    }
    const effectiveTokenAddress = tokenAddress ?? "0x0000000000000000000000000000000000000001";
    if (firstPastDeadline(input.milestones)) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid: deadlines must be in the future.");
    }

    const client = await prisma.user.findUnique({ where: { id: request.userId ?? "" } });
    if (!client) return sendError(reply, 401, "UNAUTHENTICATED", "Please sign in.");

    const parties = [client.walletAddress, input.freelancerWallet, input.arbiterWallet];
    if (parties[0] === parties[1]) {
      return sendError(reply, 400, "SAME_WALLET", "The client and freelancer must be different wallets.");
    }
    if (parties[2] === parties[0] || parties[2] === parties[1]) {
      return sendError(reply, 400, "SAME_WALLET", "The arbiter must be different from the client and freelancer.");
    }

    const milestones = input.milestones.map((milestone) => {
      // Generated here because the on-chain key is derived from it.
      const id = randomUUID();
      return { ...milestone, id, onchainMilestoneId: computeOnchainMilestoneId(id) };
    });

    for (let attempt = 1; ; attempt += 1) {
      const publicProjectId = newPublicProjectId();
      const { criteriaJson, agreementHash } = hashAgreementTerms({
        publicProjectId,
        title: input.title,
        description: input.description,
        clientWallet: client.walletAddress,
        freelancerWallet: input.freelancerWallet,
        arbiterWallet: input.arbiterWallet,
        chainId: ARC_TESTNET_CHAIN_ID,
        tokenAddress: effectiveTokenAddress,
        tokenDecimals: USDC_DECIMALS,
        milestones: milestones.map(
          (m): MilestoneTerms => ({
            onchainMilestoneId: m.onchainMilestoneId,
            title: m.title,
            amountBaseUnits: m.amount,
            deadline: m.deadline,
            criteria: m.criteria,
          }),
        ),
      });
      try {
        const created = await prisma.$transaction(async (tx) => {
          const freelancer = await upsertUserByWallet(tx, input.freelancerWallet);
          const arbiter = await upsertUserByWallet(tx, input.arbiterWallet);
          return tx.project.create({
            data: {
              publicProjectId,
              title: input.title,
              description: input.description,
              clientId: client.id,
              freelancerId: freelancer.id,
              arbiterId: arbiter.id,
              paymentMode: input.paymentMode,
              status: DRAFT,
              milestones: {
                create: milestones.map((m) => ({
                  id: m.id,
                  onchainMilestoneId: m.onchainMilestoneId,
                  title: m.title,
                  amountBaseUnits: m.amount,
                  tokenAddress: effectiveTokenAddress,
                  tokenDecimals: USDC_DECIMALS,
                  deadline: new Date(m.deadline),
                  status: DRAFT,
                  agreementVersions: { create: { version: 1, criteriaJson, agreementHash } },
                })),
              },
            },
            include: PROJECT_INCLUDE,
          });
        }, TRANSACTION_OPTIONS);
        return reply.code(201).send(toResponse(created, client.id));
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_ID_ATTEMPTS) throw error;
      }
    }
  });

  app.get("/projects", async (request) => {
    const userId = request.userId ?? "";
    const projects = await prisma.project.findMany({
      where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return { projects: projects.map((project) => toResponse(project, userId)) };
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const userId = request.userId ?? "";
    if (!PublicProjectIdSchema.safeParse(request.params.id).success) return notFound(reply);
    const project = await loadForParticipant(request.params.id, userId);
    return project ? toResponse(project, userId) : notFound(reply);
  });

  app.post<{ Params: { id: string } }>("/projects/:id/agreement/versions", async (request, reply) => {
    const userId = request.userId ?? "";
    if (!PublicProjectIdSchema.safeParse(request.params.id).success) return notFound(reply);
    if (!(await loadForParticipant(request.params.id, userId))) return notFound(reply);

    const body = ProposeVersionBodySchema.safeParse(request.body);
    if (!body.success) return invalidInput(reply, body.error);
    const proposed = body.data.milestones;
    if (firstPastDeadline(proposed)) {
      return sendError(reply, 400, "INVALID_INPUT", "The request is not valid: deadlines must be in the future.");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const { id: projectId } = await tx.project.findUniqueOrThrow({
          where: { publicProjectId: request.params.id },
          select: { id: true },
        });
        await lockProject(tx, projectId);
        const project = await tx.project.findUniqueOrThrow({
          where: { id: projectId },
          include: PROJECT_INCLUDE,
        });
        if (!NEGOTIABLE_STATUSES.includes(project.status)) {
          throw new Refusal(409, "NOT_NEGOTIABLE", "This agreement can no longer be changed.");
        }
        const existing = new Set(project.milestones.map((m) => m.id));
        const given = new Set(proposed.map((m) => m.id));
        if (
          given.size !== proposed.length ||
          given.size !== existing.size ||
          [...given].some((id) => !existing.has(id))
        ) {
          throw new Refusal(
            400,
            "MILESTONES_MISMATCH",
            "A new version must include each of this project's milestones exactly once.",
          );
        }

        const onchainIdOf = (id: string) =>
          project.milestones.find((m) => m.id === id)!.onchainMilestoneId;
        const { criteriaJson, agreementHash } = hashAgreementTerms({
          publicProjectId: project.publicProjectId,
          title: project.title,
          description: project.description,
          clientWallet: project.client.walletAddress,
          freelancerWallet: project.freelancer!.walletAddress,
          arbiterWallet: project.arbiter!.walletAddress,
          chainId: ARC_TESTNET_CHAIN_ID,
          tokenAddress: project.milestones[0]!.tokenAddress,
          tokenDecimals: project.milestones[0]!.tokenDecimals,
          milestones: proposed.map((m) => ({
            onchainMilestoneId: onchainIdOf(m.id),
            title: m.title,
            amountBaseUnits: m.amount,
            deadline: m.deadline,
            criteria: m.criteria,
          })),
        });

        // New rows only. Earlier versions, and their acceptances, are never updated.
        const version = latestVersionOf(project) + 1;
        await tx.agreementVersion.createMany({
          data: proposed.map((m) => ({ milestoneId: m.id, version, criteriaJson, agreementHash })),
        });
        // The milestone row mirrors the latest proposal. The versions are the record.
        for (const m of proposed) {
          await tx.milestone.update({
            where: { id: m.id },
            data: {
              title: m.title,
              amountBaseUnits: m.amount,
              deadline: new Date(m.deadline),
              status: DRAFT,
            },
          });
        }
        await tx.project.update({ where: { id: projectId }, data: { status: DRAFT } });
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      return refusalOr(reply, error);
    }
    const updated = await loadForParticipant(request.params.id, userId);
    return reply.code(201).send(toResponse(updated!, userId));
  });

  app.post<{ Params: { id: string } }>("/projects/:id/agreement/accept", async (request, reply) => {
    const userId = request.userId ?? "";
    if (!PublicProjectIdSchema.safeParse(request.params.id).success) return notFound(reply);
    const visible = await loadForParticipant(request.params.id, userId);
    if (!visible) return notFound(reply);

    const body = AcceptAgreementBodySchema.safeParse(request.body);
    if (!body.success) return invalidInput(reply, body.error);

    // From the session only: the request cannot choose which side accepts.
    const acceptanceField =
      visible.clientId === userId ? "clientAcceptedAt" : "freelancerAcceptedAt";

    try {
      await prisma.$transaction(async (tx) => {
        await lockProject(tx, visible.id);
        const project = await tx.project.findUniqueOrThrow({
          where: { id: visible.id },
          include: PROJECT_INCLUDE,
        });
        if (!NEGOTIABLE_STATUSES.includes(project.status)) {
          throw new Refusal(409, "NOT_NEGOTIABLE", "This agreement can no longer be changed.");
        }
        const version = latestVersionOf(project);
        if (body.data.version !== version) {
          throw new Refusal(
            409,
            "VERSION_NOT_LATEST",
            `You can only accept the latest version, which is version ${version}.`,
          );
        }
        const rows = { milestone: { projectId: project.id }, version };
        // Only timestamps, and only if not already set, so a repeat changes nothing.
        await tx.agreementVersion.updateMany({
          where: { ...rows, [acceptanceField]: null },
          data: { [acceptanceField]: now() },
        });
        const stillOpen = await tx.agreementVersion.count({
          where: { ...rows, OR: [{ clientAcceptedAt: null }, { freelancerAcceptedAt: null }] },
        });
        if (stillOpen === 0) {
          await tx.project.update({ where: { id: project.id }, data: { status: AGREED } });
          await tx.milestone.updateMany({ where: { projectId: project.id }, data: { status: AGREED } });
        }
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      return refusalOr(reply, error);
    }
    const updated = await loadForParticipant(request.params.id, userId);
    return toResponse(updated!, userId);
  });
};
