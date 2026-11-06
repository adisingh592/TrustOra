import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "CLIENT");
    const { id } = await params;
    const project = await prisma.project.findUnique({ where: { id }, select: { clientAddress: true } });
    if (!project || project.clientAddress.toLowerCase() !== address) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    const applications = await prisma.projectApplication.findMany({
      where: { projectId: id },
      select: { id: true, applicantAddress: true, message: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ success: true, applications });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("project applications error", error);
    return NextResponse.json({ success: false, error: "Could not load applications" }, { status: 500 });
  }
}
