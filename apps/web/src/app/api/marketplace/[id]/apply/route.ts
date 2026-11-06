import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "FREELANCER");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : null;
    const project = await prisma.project.findUnique({ where: { id }, select: { status: true, clientAddress: true } });
    if (!project || project.status !== "PUBLISHED") {
      return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    }
    if (project.clientAddress.toLowerCase() === address) {
      return NextResponse.json({ success: false, error: "A client cannot apply to its own project" }, { status: 403 });
    }
    const application = await prisma.projectApplication.create({
      data: { projectId: id, applicantAddress: address, message },
    });
    return NextResponse.json({ success: true, application }, { status: 201 });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ success: false, error: "You have already applied to this project" }, { status: 409 });
    }
    console.error("marketplace application error", error);
    return NextResponse.json({ success: false, error: "Could not submit application" }, { status: 500 });
  }
}
