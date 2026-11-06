import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "CLIENT");
    const { id } = await params;
    const project = await prisma.project.findUnique({ where: { id }, select: { clientAddress: true, status: true } });
    if (!project || project.clientAddress.toLowerCase() !== address) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    if (project.status !== "DRAFT") {
      return NextResponse.json({ success: false, error: "Only draft projects can be published" }, { status: 409 });
    }
    const updated = await prisma.project.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
      select: { id: true, status: true, publishedAt: true },
    });
    return NextResponse.json({ success: true, project: updated });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("publish project error", error);
    return NextResponse.json({ success: false, error: "Could not publish project" }, { status: 500 });
  }
}
