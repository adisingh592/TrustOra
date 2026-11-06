import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireAccountRole, requireSession } from "@/lib/session";

export async function GET(req: Request) {
  try {
    const { address } = await requireSession(req);
    await requireAccountRole(address, "FREELANCER");
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim();
    const skill = url.searchParams.get("skill")?.trim();
    const rawMaxBudget = url.searchParams.get("maxBudget");
    const maxBudget = Number(rawMaxBudget);
    const hasBudgetFilter = rawMaxBudget !== null && rawMaxBudget.trim() !== "" && Number.isFinite(maxBudget) && maxBudget >= 0;
    const projects = await prisma.project.findMany({
      where: {
        status: "PUBLISHED",
        ...(query ? { OR: [{ title: { contains: query } }, { description: { contains: query } }, { requiredSkills: { contains: query } }] } : {}),
        ...(skill ? { requiredSkills: { contains: skill } } : {}),
      },
      select: {
        id: true, title: true, description: true, budgetUsdc: true, requiredSkills: true,
        expectedDurationDays: true, publishedAt: true, _count: { select: { milestones: true, applications: true } },
      },
      orderBy: { publishedAt: "desc" },
    });
    const applications = await prisma.projectApplication.findMany({
    where: { applicantAddress: address, projectId: { in: projects.map((project) => project.id) } },
    select: { projectId: true, status: true },
    });
    const applicationStatus = new Map(applications.map((application) => [application.projectId, application.status]));
    return NextResponse.json({
    success: true,
    projects: projects.map((project) => ({
        ...project,
        budgetUsdc: Number(project.budgetUsdc) / 1_000_000,
        milestoneCount: project._count.milestones,
        applicationCount: project._count.applications,
        applicationStatus: applicationStatus.get(project.id) ?? null,
        ...(hasBudgetFilter && Number(project.budgetUsdc) / 1_000_000 > maxBudget ? { _excluded: true } : {}),
        _count: undefined,
      })).filter((project) => !project._excluded).map(({ _excluded, ...project }) => project),
    });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("marketplace list error", error);
    return NextResponse.json({ success: false, error: "Could not load marketplace projects" }, { status: 500 });
  }
}
