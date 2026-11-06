import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { generateCriteriaFromScope, createAgreementVersion, type CriterionItem } from "@/lib/agreement";
import { generateProjectId, recordProofTrackEvent } from "@/lib/prooftrack";
import { toUsdcBaseUnits } from "@/lib/arc";
import { authErrorResponse, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const CATEGORIES = ["FUNCTIONAL", "SECURITY", "PERFORMANCE", "UX"] as const;
const MAX_MILESTONES = 5;

/** Projects the signed-in wallet participates in (as client, freelancer or arbiter). */
export async function GET(req: Request) {
  try {
    const { address } = await requireSession(req);
    const projects = await prisma.project.findMany({
      where: {
        OR: [{ clientAddress: address }, { freelancerAddress: address }, { arbiterAddress: address }],
      },
      include: {
        milestones: { orderBy: { milestoneIndex: "asc" } },
        agreementVersions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, address, projects });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("list projects error", error);
    return NextResponse.json({ success: false, error: "Failed to fetch projects" }, { status: 500 });
  }
}

function parseCriteria(raw: unknown): CriterionItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return null;
  const out: CriterionItem[] = [];
  for (const [i, c] of raw.entries()) {
    const text = typeof c?.text === "string" ? c.text.trim() : "";
    if (!text || text.length > 500) return null;
    const category = CATEGORIES.includes(c?.category) ? c.category : "FUNCTIONAL";
    out.push({ id: `crit-${i + 1}`, text, category, mandatory: c?.mandatory !== false });
  }
  return out;
}

/**
 * Creates a DRAFT project. The client is ALWAYS the signed-in wallet; clientAddress in the body is ignored.
 * The freelancer address is required because the escrow contract needs it when the client registers the project.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    const body = await req.json().catch(() => ({}));
    const { title, description, freelancerAddress, arbiterAddress, budgetUsdc, customCriteria, milestones } = body ?? {};

    if (typeof title !== "string" || !title.trim() || title.length > 120 ||
        typeof description !== "string" || !description.trim() || description.length > 4000) {
      return NextResponse.json({ success: false, error: "title (max 120 chars) and description (max 4000 chars) are required" }, { status: 400 });
    }
    if (typeof freelancerAddress !== "string" || !isAddress(freelancerAddress, { strict: false })) {
      return NextResponse.json({ success: false, error: "A valid freelancerAddress is required" }, { status: 400 });
    }
    const freelancer = freelancerAddress.toLowerCase();
    if (freelancer === session.address) {
      return NextResponse.json({ success: false, error: "The freelancer must be a different wallet than the client" }, { status: 400 });
    }
    let arbiter: string | null = null;
    if (arbiterAddress !== undefined && arbiterAddress !== null && arbiterAddress !== "") {
      if (typeof arbiterAddress !== "string" || !isAddress(arbiterAddress, { strict: false })) {
        return NextResponse.json({ success: false, error: "arbiterAddress is not a valid address" }, { status: 400 });
      }
      arbiter = arbiterAddress.toLowerCase();
    }

    // Amounts: exact 6-decimal USDC; milestones must sum to the budget.
    let budgetUnits: bigint;
    try {
      budgetUnits = toUsdcBaseUnits(String(budgetUsdc));
    } catch {
      return NextResponse.json({ success: false, error: "budgetUsdc must be a positive USDC amount with at most 6 decimals" }, { status: 400 });
    }
    if (budgetUnits <= 0n) {
      return NextResponse.json({ success: false, error: "budgetUsdc must be greater than zero" }, { status: 400 });
    }
    let plan: Array<{ title: string; amount: string }>;
    if (milestones === undefined) {
      plan = [{ title: "Milestone 1: Core Deliverable Implementation", amount: String(budgetUsdc) }];
    } else {
      if (!Array.isArray(milestones) || milestones.length < 1 || milestones.length > MAX_MILESTONES) {
        return NextResponse.json({ success: false, error: `milestones must contain 1-${MAX_MILESTONES} items` }, { status: 400 });
      }
      plan = milestones.map((m: any, i: number) => ({
        title: typeof m?.title === "string" && m.title.trim() ? m.title.trim().slice(0, 120) : `Milestone ${i + 1}`,
        amount: String(m?.amountUsdc),
      }));
      try {
        const total = plan.reduce((sum, m) => sum + toUsdcBaseUnits(m.amount), 0n);
        if (plan.some((m) => toUsdcBaseUnits(m.amount) <= 0n) || total !== budgetUnits) throw new Error("sum");
      } catch {
        return NextResponse.json({ success: false, error: "Each milestone needs a positive USDC amount and the amounts must add up to budgetUsdc" }, { status: 400 });
      }
    }

    let criteria: CriterionItem[];
    if (customCriteria !== undefined) {
      const parsed = parseCriteria(customCriteria);
      if (!parsed) {
        return NextResponse.json({ success: false, error: "customCriteria must be 1-10 items with text up to 500 chars" }, { status: 400 });
      }
      criteria = parsed;
    } else {
      criteria = generateCriteriaFromScope(title, description);
    }
    const agreement = createAgreementVersion(criteria, 1);

    // Retry on the (unlikely) project-id collision between concurrent creators.
    let project = null;
    const base = await prisma.project.count();
    for (let attempt = 0; attempt < 5 && !project; attempt++) {
      const projectId = generateProjectId(2026, base + 1042 + attempt);
      try {
        project = await prisma.project.create({
          data: {
            id: projectId,
            title: title.trim(),
            description: description.trim(),
            clientAddress: session.address,
            freelancerAddress: freelancer,
            arbiterAddress: arbiter,
            budgetUsdc: Number(budgetUnits) / 1_000_000,
            status: "DRAFT",
            agreementVersions: {
              create: {
                versionNumber: 1,
                criteriaJson: JSON.stringify(agreement.criteria),
                criteriaHash: agreement.criteriaHash,
                clientAccepted: true, // the authenticated proposer accepts their own agreement
                freelancerAccepted: false,
              },
            },
            milestones: {
              create: plan.map((m, i) => ({
                milestoneIndex: i + 1,
                title: m.title,
                description: `Satisfies agreed criteria v1 (${agreement.criteriaHash.slice(0, 12)}…)`,
                amountUsdc: Number(toUsdcBaseUnits(m.amount)) / 1_000_000,
                state: "UNFUNDED",
                criteriaHash: agreement.criteriaHash,
              })),
            },
          },
          include: { milestones: true, agreementVersions: true },
        });
      } catch (err: any) {
        if (err?.code !== "P2002") throw err;
      }
    }
    if (!project) {
      return NextResponse.json({ success: false, error: "Could not allocate a project id, try again" }, { status: 503 });
    }

    await recordProofTrackEvent({
      projectId: project.id,
      ecosystem: "TRUSTORA_CORE",
      eventType: "PROJECT_INITIALIZED",
      referenceType: "APPLICATION_EVENT_ID",
      referenceValue: project.id,
      verificationStatus: "PENDING",
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error("create project error", error);
    return NextResponse.json({ success: false, error: "Failed to create project" }, { status: 500 });
  }
}
