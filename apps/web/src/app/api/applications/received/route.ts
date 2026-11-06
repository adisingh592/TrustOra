import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function GET(req: Request) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "CLIENT");
    const applications = await prisma.projectApplication.findMany({
      where: { project: { clientAddress: address } },
      select: {
        id: true,
        applicantAddress: true,
        message: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        project: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, applications });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("received applications error", error);
    return NextResponse.json({ success: false, error: "Could not load received applications" }, { status: 500 });
  }
}
