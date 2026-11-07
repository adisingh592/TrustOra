import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordProofTrackEvent, recordHederaAuditEvent } from "@/lib/prooftrack";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";
import { rolesOf } from "@/lib/authz";
import { buildAgreementMessage, verifyAgreementSignature } from "@/lib/siwe";

export const dynamic = "force-dynamic";

/**
 * The freelancer accepts the frozen agreement by signing the acceptance message with their wallet.
 * The role is derived from the session wallet and the project; any role/wallet in the body is ignored.
 * The client accepted when creating the project. Body: { signature }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession(req);
    const body = await req.json().catch(() => ({}));

    const project = await prisma.project.findUnique({
      where: { id },
      include: { agreementVersions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const roles = project ? rolesOf(session.address, project) : [];
    if (!project || roles.length === 0) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    const agreement = project.agreementVersions[0];
    if (!agreement) {
      return NextResponse.json({ success: false, error: "No agreement version found" }, { status: 400 });
    }
    if (!roles.includes("freelancer")) {
      return NextResponse.json(
        { success: false, error: "Only the project freelancer accepts the agreement; the client accepted when creating it" },
        { status: 403 }
      );
    }
    await requireAccountRole(session.address, "FREELANCER");
    if (agreement.freelancerAccepted) {
      return NextResponse.json({ success: true, agreement, bothAccepted: agreement.isLocked, alreadyAccepted: true });
    }

    const signature = body?.signature;
    if (typeof signature !== "string") {
      return NextResponse.json({ success: false, error: "A wallet signature of the acceptance message is required" }, { status: 400 });
    }
    const message = buildAgreementMessage({
      projectId: project.id,
      versionNumber: agreement.versionNumber,
      criteriaHash: agreement.criteriaHash,
      role: "FREELANCER",
    });
    if (!(await verifyAgreementSignature({ message, signature, expectedAddress: session.address }))) {
      return NextResponse.json({ success: false, error: "Signature does not match the acceptance message for your wallet" }, { status: 401 });
    }

    // Compare-and-set so a double submit cannot lock twice.
    const result = await prisma.agreementVersion.updateMany({
      // Re-check the assignment in the compare-and-set so a concurrent client re-invite
      // cannot let a previously assigned wallet accept after it has been replaced.
      where: { id: agreement.id, freelancerAccepted: false, project: { freelancerAddress: session.address } },
      data: { freelancerAccepted: true, freelancerSignature: signature, isLocked: agreement.clientAccepted },
    });
    if (result.count !== 1) {
      return NextResponse.json({ success: false, error: "This invitation changed or was already accepted. Reload the project." }, { status: 409 });
    }
    const updated = await prisma.agreementVersion.findUniqueOrThrow({ where: { id: agreement.id } });

    if (result.count === 1 && updated.isLocked) {
      await prisma.project.update({ where: { id: project.id }, data: { status: "AGREED" } });
      await recordProofTrackEvent({
        projectId: project.id,
        ecosystem: "TRUSTORA_CORE",
        eventType: "AGREEMENT_LOCKED",
        referenceType: "APPLICATION_EVENT_ID",
        referenceValue: `${project.id}-AGR-v${agreement.versionNumber}`,
        verificationStatus: "PENDING",
      });
      await recordHederaAuditEvent({
        projectId: project.id,
        activityType: "AGREEMENT_ACCEPTED",
        referenceValue: `${project.id}-HCS-AGR-v${agreement.versionNumber}`,
        verificationStatus: "PENDING",
      });
    }

    return NextResponse.json({ success: true, agreement: updated, bothAccepted: updated.isLocked });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("accept agreement error", error);
    return NextResponse.json({ success: false, error: "Failed to accept agreement" }, { status: 500 });
  }
}
