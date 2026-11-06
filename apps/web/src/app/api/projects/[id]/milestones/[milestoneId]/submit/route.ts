import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { recordProofTrackEvent } from "@/lib/prooftrack";
import {
  escrowErrorResponse,
  loadMilestoneInProject,
  readJsonBody,
  syncEscrowTx,
} from "@/lib/escrow-db";
import { requireSession } from "@/lib/session";
import { ACTION_ROLES, canPerform } from "@/lib/authz";
import { MAX_DELIVERABLE_CHARS as EVALUATOR_MAX_CHARS } from "@/lib/0g";

// The evaluator reads at most this many characters. Accepting more would mean part of the work is never assessed,
// so oversize text is refused rather than silently truncated. Larger work belongs behind a URI with a summary.
const MAX_DELIVERABLE_CHARS = EVALUATOR_MAX_CHARS;

/**
 * Two-step deliverable submission:
 *  1. { deliverableContent, deliverableUri?, notes? } stores the off-chain submission and returns the
 *     bytes32 hash the freelancer's wallet must anchor with submitMilestoneWork. State does NOT change.
 *  2. { txHash, submissionId? } verifies that on-chain transaction (its deliverable hash must equal the
 *     stored submission) and only then moves the milestone to SUBMITTED.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  try {
    const { id, milestoneId } = await params;
    const session = await requireSession(req);
    const body = await readJsonBody(req);

    if (body.txHash !== undefined) {
      if (body.deliverableContent !== undefined) {
        return NextResponse.json(
          { success: false, error: "Send either deliverableContent or txHash, not both" },
          { status: 400 }
        );
      }
      if (typeof body.txHash !== "string" || !body.txHash) {
        return NextResponse.json({ success: false, error: "Missing txHash" }, { status: 400 });
      }
      return await syncEscrowTx({
        wallet: session.address,
        projectId: id,
        milestoneId,
        txHash: body.txHash,
        action: "submit",
        submissionId: typeof body.submissionId === "string" ? body.submissionId : undefined,
      });
    }

    const { deliverableContent, deliverableUri, notes } = body;
    if (typeof deliverableContent !== "string" || !deliverableContent) {
      return NextResponse.json(
        { success: false, error: "Missing deliverableContent" },
        { status: 400 }
      );
    }
    if (deliverableContent.length > MAX_DELIVERABLE_CHARS) {
      return NextResponse.json(
        { success: false, error: `Deliverable text is limited to ${MAX_DELIVERABLE_CHARS.toLocaleString("en-US")} characters so that all of it can be evaluated. For larger work, submit a summary here and put the full material behind a URI.` },
        { status: 413 }
      );
    }

    const milestone = await loadMilestoneInProject(id, milestoneId);
    if (!milestone) {
      return NextResponse.json({ success: false, error: "Milestone not found in this project" }, { status: 404 });
    }
    if (!canPerform(session.address, milestone.project, ACTION_ROLES.submit)) {
      return NextResponse.json({ success: false, error: "Only the project freelancer can submit work" }, { status: 403 });
    }
    if (milestone.state !== "FUNDED" && milestone.state !== "REVISION_REQUESTED") {
      return NextResponse.json(
        { success: false, error: `Milestone is ${milestone.state}; work can only be submitted when it is FUNDED or REVISION_REQUESTED` },
        { status: 409 }
      );
    }

    const deliverableHash = crypto.createHash("sha256").update(deliverableContent).digest("hex");
    const submissionCount = await prisma.submission.count({ where: { milestoneId } });

    const submission = await prisma.submission.create({
      data: {
        milestoneId,
        version: submissionCount + 1,
        deliverableHash,
        deliverableUri: typeof deliverableUri === "string" && deliverableUri ? deliverableUri : null,
        contentSummary: deliverableContent.slice(0, 300),
        content: deliverableContent,
        notes: typeof notes === "string" && notes ? notes : null,
      },
    });

    // Application-level record only; the on-chain submission is recorded after verification.
    await recordProofTrackEvent({
      projectId: id,
      ecosystem: "TRUSTORA_CORE",
      eventType: "DELIVERABLE_STORED",
      referenceType: "APPLICATION_EVENT_ID",
      referenceValue: submission.id,
      verificationStatus: "PENDING",
    });

    return NextResponse.json({
      success: true,
      submission,
      deliverableHash,
      anchor: {
        milestoneId: milestone.milestoneIndex,
        deliverableHash: `0x${deliverableHash}`,
        deliverableUri: submission.deliverableUri,
        note: "Sign submitMilestoneWork with the freelancer wallet, then POST { txHash, submissionId } here.",
      },
    });
  } catch (error) {
    return escrowErrorResponse(error, "Failed to submit deliverable");
  }
}
