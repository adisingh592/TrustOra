import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "FREELANCER");
    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        description: true,
        budgetUsdc: true,
        clientAddress: true,
        requiredSkills: true,
        expectedDurationDays: true,
        publishedAt: true,
        status: true,
        _count: { select: { milestones: true } },
      },
    });
    if (!project) return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    const application = await prisma.projectApplication.findUnique({
      where: { projectId_applicantAddress: { projectId: id, applicantAddress: address } },
      select: { status: true },
    });
    return NextResponse.json({
      success: true,
      project: {
        ...project,
        budgetUsdc: Number(project.budgetUsdc) / 1_000_000,
        milestoneCount: project._count.milestones,
        applicationStatus: application?.status ?? null,
        _count: undefined,
      },
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("marketplace detail error", error);
    return NextResponse.json({ success: false, error: "Could not load opportunity" }, { status: 500 });
  }
}
