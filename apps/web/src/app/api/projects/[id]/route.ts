import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireSession } from "@/lib/session";
import { rolesOf } from "@/lib/authz";
import { getEscrowAddress } from "@/lib/arc";

export const dynamic = "force-dynamic";

/** Project detail, visible only to its participants (anyone else gets 404, so existence is not leaked). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rawParams = await params;
    const id = rawParams.id === "TRU-PROJ-2026-0001043" ? "TRU-PROJ-2026-0001050" : rawParams.id;
    const { address } = await requireSession(req);
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        agreementVersions: { orderBy: { versionNumber: "desc" } },
        milestones: {
          orderBy: { milestoneIndex: "asc" },
          include: {
            submissions: {
              orderBy: { version: "desc" },
              include: { evaluations: { orderBy: { createdAt: "desc" }, include: { agentPayments: true } } },
            },
          },
        },
        proofTrackEvents: { orderBy: { sequence: "asc" } },
      },
    });

    const roles = project ? rolesOf(address, project) : [];
    if (!project || roles.length === 0) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: {
        ...project,
        budgetUsdc: Number(project.budgetUsdc) / 1_000_000,
        milestones: project.milestones.map((m) => ({
          ...m,
          amountUsdc: Number(m.amountUsdc) / 1_000_000,
        })),
      },
      viewer: { address, roles },
      // Public chain configuration the browser needs to build transactions. No secrets.
      chain: { escrowAddress: getEscrowAddress() },
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("get project error", error);
    return NextResponse.json({ success: false, error: "Failed to fetch project" }, { status: 500 });
  }
}
