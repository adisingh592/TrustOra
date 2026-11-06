import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; applicationId: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "CLIENT");
    const { id, applicationId } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id }, select: { clientAddress: true, freelancerAddress: true, status: true } });
      const application = await tx.projectApplication.findUnique({ where: { id: applicationId } });
      if (!project || !application || application.projectId !== id || project.clientAddress.toLowerCase() !== address) {
        return { status: 404 as const, error: "Application not found" };
      }
      if (project.status !== "PUBLISHED" && project.status !== "DRAFT") {
        return { status: 409 as const, error: "Applications can only be approved before the project agreement begins" };
      }
      if (project.freelancerAddress && project.freelancerAddress.toLowerCase() !== application.applicantAddress.toLowerCase()) {
        return { status: 409 as const, error: "A different freelancer is already assigned to this project" };
      }
      const claimed = await tx.projectApplication.updateMany({
        where: { id: applicationId, projectId: id, status: "PENDING" },
        data: { status: "APPROVED" },
      });
      if (claimed.count !== 1) {
        return { status: 409 as const, error: "This application has already been decided" };
      }
      await tx.project.update({ where: { id }, data: { freelancerAddress: application.applicantAddress, status: "DRAFT" } });
      await tx.projectApplication.updateMany({ where: { projectId: id, id: { not: applicationId }, status: "PENDING" }, data: { status: "REJECTED" } });
      const updated = await tx.projectApplication.findUniqueOrThrow({ where: { id: applicationId } });
      return { status: 200 as const, application: updated };
    });
    if (result.status !== 200) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, application: result.application });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("approve application error", error);
    return NextResponse.json({ success: false, error: "Could not approve application" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; applicationId: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "CLIENT");
    const { id, applicationId } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id }, select: { clientAddress: true, status: true } });
      const application = await tx.projectApplication.findUnique({ where: { id: applicationId } });
      if (!project || !application || application.projectId !== id || project.clientAddress.toLowerCase() !== address) {
        return { status: 404 as const, error: "Application not found" };
      }
      const updatedCount = await tx.projectApplication.updateMany({
        where: { id: applicationId, projectId: id, status: "PENDING" },
        data: { status: "REJECTED" },
      });
      if (updatedCount.count !== 1) return { status: 409 as const, error: "This application has already been decided" };
      const updated = await tx.projectApplication.findUniqueOrThrow({ where: { id: applicationId } });
      return { status: 200 as const, application: updated };
    });
    if (result.status !== 200) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, application: result.application });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("reject application error", error);
    return NextResponse.json({ success: false, error: "Could not reject application" }, { status: 500 });
  }
}
