import type { RiskLevel, TrustRiskIndicator, TrustShieldReport } from "@trustora/shared";

export interface ProjectHistoryData {
  publicProjectId: string;
  projectStatus: string;
  milestones: {
    id: string;
    title: string;
    deadline: Date;
    status: string;
    agreementVersions: { version: number }[];
    submissions: { id: string; status: string; submittedAt: Date }[];
  }[];
  now: Date;
}

export const computeTrustShieldReport = (data: ProjectHistoryData): TrustShieldReport => {
  const evaluatedAt = data.now.toISOString();
  const { milestones, now } = data;

  // 1. Deadline Adherence Analysis
  let missedMilestonesCount = 0;
  for (const m of milestones) {
    const isCompleted =
      m.status === "APPROVED" ||
      m.status === "RELEASED" ||
      m.status === "RESOLVED";
    if (!isCompleted && m.deadline < now) {
      missedMilestonesCount += 1;
    }
  }

  let deadlineLevel: RiskLevel = "LOW";
  let deadlineReason = "All milestones are within their agreed schedule.";
  if (missedMilestonesCount > 1) {
    deadlineLevel = "HIGH";
    deadlineReason = `${missedMilestonesCount} milestones have exceeded their agreed deadlines without completion.`;
  } else if (missedMilestonesCount === 1) {
    deadlineLevel = "MEDIUM";
    deadlineReason = "1 milestone has exceeded its deadline.";
  }

  const deadlineAdherence: TrustRiskIndicator = {
    level: deadlineLevel,
    reason: deadlineReason,
    details: {
      totalMilestones: milestones.length,
      missedMilestones: missedMilestonesCount,
    },
  };

  // 2. Scope Volatility Analysis
  const allVersions = new Set<number>();
  for (const m of milestones) {
    for (const v of m.agreementVersions) {
      allVersions.add(v.version);
    }
  }
  const totalVersions = allVersions.size || 1;

  let scopeLevel: RiskLevel = "LOW";
  let scopeReason = "Agreement scope maintained with minimal changes.";
  if (totalVersions > 4) {
    scopeLevel = "HIGH";
    scopeReason = `High scope volatility: ${totalVersions} agreement versions proposed.`;
  } else if (totalVersions > 2) {
    scopeLevel = "MEDIUM";
    scopeReason = `Moderate scope adjustments across ${totalVersions} versions.`;
  }

  const scopeVolatility: TrustRiskIndicator = {
    level: scopeLevel,
    reason: scopeReason,
    details: {
      totalVersions,
    },
  };

  // 3. Submission & Revision History Analysis
  let totalSubmissions = 0;
  let maxSubmissionsPerMilestone = 0;
  let revisionRequestedCount = 0;

  for (const m of milestones) {
    const subCount = m.submissions.length;
    totalSubmissions += subCount;
    if (subCount > maxSubmissionsPerMilestone) {
      maxSubmissionsPerMilestone = subCount;
    }
    if (m.status === "REVISION_REQUESTED") {
      revisionRequestedCount += 1;
    }
  }

  let submissionLevel: RiskLevel = "LOW";
  let submissionReason = "Submissions completed on schedule without repeated revision loops.";
  if (maxSubmissionsPerMilestone >= 3 || revisionRequestedCount > 1) {
    submissionLevel = "HIGH";
    submissionReason = `Repeated revision cycles detected (${maxSubmissionsPerMilestone} submissions on milestone).`;
  } else if (maxSubmissionsPerMilestone === 2 || revisionRequestedCount === 1) {
    submissionLevel = "MEDIUM";
    submissionReason = "Iterative revisions requested on deliverable.";
  }

  const submissionHistory: TrustRiskIndicator = {
    level: submissionLevel,
    reason: submissionReason,
    details: {
      totalSubmissions,
      maxSubmissionsPerMilestone,
      revisionRequestedCount,
    },
  };

  // 4. Dispute History Analysis
  const hasDisputedMilestone = milestones.some((m) => m.status === "DISPUTED");
  const isProjectDisputed = data.projectStatus === "DISPUTED";
  const hasDisputes = hasDisputedMilestone || isProjectDisputed;

  let disputeLevel: RiskLevel = "LOW";
  let disputeReason = "Zero active disputes or arbitration requests.";
  if (hasDisputes) {
    disputeLevel = "HIGH";
    disputeReason = "Active dispute flagged on project or milestone.";
  }

  const disputeHistory: TrustRiskIndicator = {
    level: disputeLevel,
    reason: disputeReason,
    details: {
      hasDisputes,
      isProjectDisputed,
    },
  };

  // Overall Risk Calculation
  const levels = [deadlineLevel, scopeLevel, submissionLevel, disputeLevel];
  let overallRisk: RiskLevel = "LOW";
  if (levels.includes("HIGH")) {
    overallRisk = "HIGH";
  } else if (levels.includes("MEDIUM")) {
    overallRisk = "MEDIUM";
  }

  const heuristicNotes = [
    "TrustShield indicators are advisory behavioral heuristics designed for explainability.",
    "Risk assessments do not automate escrow movement, penalize participants, or override contractual agreements.",
    "Calculations reflect verifiable database events including deadlines, version churn, submissions, and dispute statuses.",
  ];

  const explanation =
    overallRisk === "LOW"
      ? "Project demonstrates healthy progress, timely deliverables, and low scope volatility."
      : overallRisk === "MEDIUM"
        ? "Moderate risk factors detected: inspect schedule delays or revision requests."
        : "Elevated risk factors detected: review missed deadlines, dispute flags, or repeated revision cycles.";

  return {
    publicProjectId: data.publicProjectId,
    evaluatedAt,
    deadlineAdherence,
    scopeVolatility,
    submissionHistory,
    disputeHistory,
    overallRisk,
    overallConfidence: 0.95,
    explanation,
    heuristicNotes,
  };
};
