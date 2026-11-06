/**
 * Applies chain-verified escrow results to SQLite. Only verifyEscrowTx output (never the request body)
 * decides what is written. The browser wallet signs and sends the transaction; the backend holds no keys
 * and never sends any transaction.
 */
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { arcPublicClient, getEscrowAddress } from "./arc";
import { recordProofTrackEvent } from "./prooftrack";
import { ACTION_ROLES, canPerform, isParticipant } from "./authz";
import { authErrorResponse, requireAccountRole, requireSession } from "./session";
import {
  ESCROW_ACTIONS,
  EscrowSyncError,
  deriveProjectStatus,
  planDbTransition,
  verifyEscrowTx,
  verifyRegistrationTx,
  type ChainReader,
  type EscrowAction,
} from "./escrow-sync";

export function escrowErrorResponse(error: unknown, fallback: string) {
  const auth = authErrorResponse(error);
  if (auth) return auth;
  if (error instanceof EscrowSyncError) {
    return NextResponse.json(
      { success: false, code: error.code, error: error.message },
      { status: error.httpStatus },
    );
  }
  console.error(fallback, error);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/** Loads a milestone only if it belongs to the project in the URL. */
export async function loadMilestoneInProject(projectId: string, milestoneId: string) {
  return prisma.milestone.findFirst({
    where: { id: milestoneId, projectId },
    include: { project: true },
  });
}

/** Verifies `txHash` for `action` against Arc and, only if the chain agrees, syncs the database. */
export async function syncEscrowTx(params: {
  /** Authenticated session wallet. Identity is never taken from the request body. */
  wallet: string;
  projectId: string;
  milestoneId: string;
  txHash: string;
  action: EscrowAction;
  /** For `submit`: DB submission the freelancer claims to have anchored (defaults to the latest). */
  submissionId?: string;
}) {
  const { projectId, milestoneId, txHash, action } = params;
  const milestone = await loadMilestoneInProject(projectId, milestoneId);
  if (!milestone) {
    return NextResponse.json({ success: false, error: "Milestone not found in this project" }, { status: 404 });
  }
  if (!isParticipant(params.wallet, milestone.project)) {
    return NextResponse.json({ success: false, error: "Milestone not found in this project" }, { status: 404 });
  }
  if (!canPerform(params.wallet, milestone.project, ACTION_ROLES[action])) {
    return NextResponse.json(
      { success: false, error: `Your wallet is not allowed to perform "${action}" on this project` },
      { status: 403 },
    );
  }
  if (!milestone.criteriaHash) {
    return NextResponse.json({ success: false, error: "Milestone has no locked criteria hash" }, { status: 409 });
  }

  let submission = null;
  if (action === "submit") {
    submission = params.submissionId
      ? await prisma.submission.findFirst({ where: { id: params.submissionId, milestoneId } })
      : await prisma.submission.findFirst({ where: { milestoneId }, orderBy: { version: "desc" } });
    if (!submission) {
      return NextResponse.json({ success: false, error: "No stored submission to match the on-chain deliverable" }, { status: 409 });
    }
  }

  const escrowAddress = getEscrowAddress();
  const verified = await verifyEscrowTx(arcPublicClient as unknown as ChainReader, {
    txHash,
    escrowAddress,
    action,
    expected: {
      projectId,
      milestoneIndex: milestone.milestoneIndex,
      clientAddress: milestone.project.clientAddress,
      freelancerAddress: milestone.project.freelancerAddress,
      arbiterAddress: milestone.project.arbiterAddress,
      criteriaHash: milestone.criteriaHash,
      amountUsdc: milestone.amountUsdc,
      expectedDeliverableHash: submission?.deliverableHash,
    },
  });

  const plan = planDbTransition(milestone.state, verified.dbState);
  let changed = false;

  if (plan === "ADVANCE") {
    const isRelease = verified.dbState === "RELEASED";
    const result = await prisma.milestone.updateMany({
      // Compare-and-set on the state we planned from, so a concurrent sync cannot be overwritten.
      where: { id: milestone.id, state: milestone.state },
      data: {
        state: verified.dbState,
        ...(action === "fund" && !milestone.fundingTxHash
          ? { fundingTxHash: verified.txHash, fundedAt: new Date() }
          : {}),
        ...(isRelease && !milestone.releaseTxHash
          ? { releaseTxHash: verified.txHash, releasedAt: new Date() }
          : {}),
      },
    });
    changed = result.count === 1;
  }

  if (action === "submit" && submission) {
    // Mark this exact submission as the one anchored on Arc (the evaluator only reads anchored work).
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        anchorTxHash: submission.anchorTxHash ?? verified.txHash,
        ...(!submission.deliverableUri && verified.chain.deliverableUri ? { deliverableUri: verified.chain.deliverableUri } : {}),
      },
    });
  }

  const allMilestones = await prisma.milestone.findMany({ where: { projectId }, select: { state: true } });
  const projectStatus = deriveProjectStatus(milestone.project.status, allMilestones.map((m) => m.state));
  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: projectStatus,
      escrowContractAddress: escrowAddress, // from server config, never from the request
    },
  });

  // VERIFIED is reached only here, after the receipt, logs, sender role and contract state all checked out.
  await recordProofTrackEvent({
    projectId,
    ecosystem: "ARC",
    eventType: ESCROW_ACTIONS[action].proofEventType,
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: verified.txHash,
    verificationStatus: "VERIFIED",
  });

  const updated = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  return NextResponse.json({
    success: true,
    action,
    changed,
    chainState: verified.chainState,
    projectStatus,
    projectCompleted: projectStatus === "COMPLETED",
    milestone: updated,
    verification: {
      txHash: verified.txHash,
      blockNumber: verified.blockNumber.toString(),
      sender: verified.sender,
      senderRole: verified.senderRole,
    },
  });
}

/** Shared POST handler for routes whose body is just `{ txHash }`. */
export async function handleEscrowTxRequest(
  req: Request,
  params: { id: string; milestoneId: string },
  action: EscrowAction,
) {
  try {
    const session = await requireSession(req);
    const accountRole = action === "submit" || action === "refund" ? "FREELANCER" : action === "dispute" ? null : "CLIENT";
    if (accountRole) await requireAccountRole(session.address, accountRole);
    const body = await readJsonBody(req);
    if (typeof body.txHash !== "string" || !body.txHash) {
      return NextResponse.json({ success: false, error: "Missing txHash" }, { status: 400 });
    }
    return await syncEscrowTx({
      wallet: session.address,
      projectId: params.id,
      milestoneId: params.milestoneId,
      txHash: body.txHash,
      action,
    });
  } catch (error) {
    return escrowErrorResponse(error, `Failed to sync ${action}`);
  }
}

// ---------------------------------------------------------------------------
// On-chain registration: createProject and addMilestone.
// A DB project/milestone does NOT imply it exists on-chain; these routes prove it from the chain.
// ---------------------------------------------------------------------------

async function loadProjectForClient(projectId: string, wallet: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { agreementVersions: { orderBy: { versionNumber: "desc" }, take: 1 }, milestones: true },
  });
  if (!project || !isParticipant(wallet, project)) return { error: NextResponse.json({ success: false, error: "Project not found" }, { status: 404 }) };
  if (!canPerform(wallet, project, ["client"])) {
    return { error: NextResponse.json({ success: false, error: "Only the project client can register it on-chain" }, { status: 403 }) };
  }
  const agreement = project.agreementVersions[0];
  if (!agreement?.isLocked) {
    return { error: NextResponse.json({ success: false, error: "Both parties must accept the agreement before it is registered on-chain" }, { status: 409 }) };
  }
  return { project, agreement };
}

/** POST body { txHash }: records a createProject transaction after verifying it on Arc. */
export async function handleRegisterProject(req: Request, params: { id: string }) {
  try {
    const session = await requireSession(req);
    const body = await readJsonBody(req);
    if (typeof body.txHash !== "string" || !body.txHash) {
      return NextResponse.json({ success: false, error: "Missing txHash" }, { status: 400 });
    }
    const loaded = await loadProjectForClient(params.id, session.address);
    if (loaded.error) return loaded.error;
    await requireAccountRole(session.address, "CLIENT");
    const { project } = loaded;

    const escrowAddress = getEscrowAddress();
    const verified = await verifyRegistrationTx(arcPublicClient as unknown as ChainReader, {
      txHash: body.txHash,
      escrowAddress,
      kind: "project",
      expected: {
        projectId: project.id,
        clientAddress: project.clientAddress,
        freelancerAddress: project.freelancerAddress,
        arbiterAddress: project.arbiterAddress,
      },
    });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        registerTxHash: project.registerTxHash ?? verified.txHash,
        escrowContractAddress: escrowAddress,
        // Adopt the arbiter the contract actually stores (the owner when none was given) so that role is known.
        arbiterAddress: project.arbiterAddress ?? verified.chainArbiter.toLowerCase(),
      },
    });
    await recordProofTrackEvent({
      projectId: project.id,
      ecosystem: "ARC",
      eventType: "ESCROW_PROJECT_REGISTERED",
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      referenceValue: verified.txHash,
      verificationStatus: "VERIFIED",
    });
    return NextResponse.json({
      success: true,
      project: updated,
      verification: { txHash: verified.txHash, blockNumber: verified.blockNumber.toString(), sender: verified.sender },
    });
  } catch (error) {
    return escrowErrorResponse(error, "Failed to register project on-chain");
  }
}

/** POST body { txHash }: records an addMilestone transaction after verifying it on Arc. */
export async function handleRegisterMilestone(req: Request, params: { id: string; milestoneId: string }) {
  try {
    const session = await requireSession(req);
    const body = await readJsonBody(req);
    if (typeof body.txHash !== "string" || !body.txHash) {
      return NextResponse.json({ success: false, error: "Missing txHash" }, { status: 400 });
    }
    const loaded = await loadProjectForClient(params.id, session.address);
    if (loaded.error) return loaded.error;
    await requireAccountRole(session.address, "CLIENT");
    const { project } = loaded;

    const milestone = project.milestones.find((m) => m.id === params.milestoneId);
    if (!milestone) {
      return NextResponse.json({ success: false, error: "Milestone not found in this project" }, { status: 404 });
    }
    if (!project.registerTxHash) {
      return NextResponse.json({ success: false, error: "Register the project on-chain first" }, { status: 409 });
    }
    if (!milestone.criteriaHash) {
      return NextResponse.json({ success: false, error: "Milestone has no locked criteria hash" }, { status: 409 });
    }
    // The contract numbers milestones 1..n in the order they are added.
    const earlierUnregistered = project.milestones.some((m) => m.milestoneIndex < milestone.milestoneIndex && !m.addTxHash);
    if (earlierUnregistered) {
      return NextResponse.json({ success: false, error: "Register earlier milestones on-chain first (the contract numbers them in order)" }, { status: 409 });
    }

    const verified = await verifyRegistrationTx(arcPublicClient as unknown as ChainReader, {
      txHash: body.txHash,
      escrowAddress: getEscrowAddress(),
      kind: "milestone",
      expected: {
        projectId: project.id,
        clientAddress: project.clientAddress,
        freelancerAddress: project.freelancerAddress,
        arbiterAddress: project.arbiterAddress,
        milestoneIndex: milestone.milestoneIndex,
        criteriaHash: milestone.criteriaHash,
        amountUsdc: milestone.amountUsdc,
      },
    });

    const updated = await prisma.milestone.update({
      where: { id: milestone.id },
      data: { addTxHash: milestone.addTxHash ?? verified.txHash },
    });
    await recordProofTrackEvent({
      projectId: project.id,
      ecosystem: "ARC",
      eventType: "ESCROW_MILESTONE_ADDED",
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      referenceValue: verified.txHash,
      verificationStatus: "VERIFIED",
    });
    return NextResponse.json({
      success: true,
      milestone: updated,
      verification: { txHash: verified.txHash, blockNumber: verified.blockNumber.toString(), sender: verified.sender },
    });
  } catch (error) {
    return escrowErrorResponse(error, "Failed to register milestone on-chain");
  }
}
