import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function GET(req: Request) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "FREELANCER");
    const applications = await prisma.projectApplication.findMany({
      where: { applicantAddress: address },
      select: {
        id: true,
        message: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        project: { select: { id: true, title: true, status: true, budgetUsdc: true, requiredSkills: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      success: true,
      applications: applications.map((application) => ({
        ...application,
        project: { ...application.project, budgetUsdc: Number(application.project.budgetUsdc) / 1_000_000 },
      })),
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("my applications error", error);
    return NextResponse.json({ success: false, error: "Could not load your applications" }, { status: 500 });
  }
}
