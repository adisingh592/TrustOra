import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Assign or reassign the freelancer before agreement acceptance or any escrow registration/funding. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { address } = await requireSession(req);
    const body = await req.json().catch(() => ({}));
    const candidate = body?.freelancerAddress;
    if (typeof candidate !== "string" || !isAddress(candidate, { strict: false })) {
      return NextResponse.json({ success: false, error: "A valid freelancerAddress is required" }, { status: 400 });
    }
    const freelancerAddress = candidate.toLowerCase();
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: params.id },
        include: { agreementVersions: { orderBy: { versionNumber: "desc" }, take: 1 }, milestones: true },
      });
      if (!project || project.clientAddress.toLowerCase() !== address) return { status: 404 as const, error: "Project not found" };
      if (freelancerAddress === address) return { status: 400 as const, error: "The freelancer must be a different wallet than the client" };
      const agreement = project.agreementVersions[0];
      if (project.registerTxHash || agreement?.isLocked || agreement?.freelancerAccepted || project.milestones.some((m) => m.state !== "UNFUNDED")) {
        return { status: 409 as const, error: "The freelancer can only be changed before the agreement is accepted and before any milestone is registered or funded" };
      }
      await tx.project.update({ where: { id: project.id }, data: { freelancerAddress } });
      return { status: 200 as const };
    });

    if (result.status !== 200) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, freelancerAddress, invitation: "PENDING_AGREEMENT_SIGNATURE" });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("invite freelancer error", error);
    return NextResponse.json({ success: false, error: "Could not assign freelancer" }, { status: 500 });
  }
}
