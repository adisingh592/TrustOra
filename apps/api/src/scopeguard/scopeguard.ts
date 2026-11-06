import type {
  RiskLevel,
  ScopeChangeCriterionDiff,
  ScopeChangeMilestoneDiff,
  ScopeGuardReport,
} from "@trustora/shared";
import type { AgreementTerms, MilestoneTerms } from "../projects/agreement.js";

export interface VersionInfo {
  version: number;
  criteriaJson: string;
  clientAcceptedAt: Date | null;
  freelancerAcceptedAt: Date | null;
}

export const diffCriteria = (
  baseCriteria: string[],
  targetCriteria: string[],
): ScopeChangeCriterionDiff[] => {
  const diffs: ScopeChangeCriterionDiff[] = [];
  const baseSet = new Set(baseCriteria);
  const targetSet = new Set(targetCriteria);

  // Criteria in target
  for (const criterion of targetCriteria) {
    if (baseSet.has(criterion)) {
      diffs.push({ type: "UNCHANGED", criterion });
    } else {
      diffs.push({ type: "ADDED", criterion });
    }
  }

  // Criteria in base but not in target
  for (const criterion of baseCriteria) {
    if (!targetSet.has(criterion)) {
      diffs.push({ type: "REMOVED", criterion });
    }
  }

  return diffs;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const diffMilestones = (
  baseMilestones: MilestoneTerms[],
  targetMilestones: MilestoneTerms[],
): ScopeChangeMilestoneDiff[] => {
  const diffs: ScopeChangeMilestoneDiff[] = [];
  const baseMap = new Map<string, MilestoneTerms>(
    baseMilestones.map((m) => [m.onchainMilestoneId, m]),
  );
  const targetMap = new Map<string, MilestoneTerms>(
    targetMilestones.map((m) => [m.onchainMilestoneId, m]),
  );

  // Check target milestones (UNCHANGED, MODIFIED, ADDED)
  for (const target of targetMilestones) {
    const base = baseMap.get(target.onchainMilestoneId);
    if (!base) {
      diffs.push({
        milestoneId: target.onchainMilestoneId,
        title: target.title,
        type: "ADDED",
        deadlineShiftDays: 0,
        amountDeltaBaseUnits: target.amountBaseUnits,
        criteriaDiffs: target.criteria.map((c) => ({ type: "ADDED", criterion: c })),
      });
      continue;
    }

    const deadlineShift = Math.round(
      (new Date(target.deadline).getTime() - new Date(base.deadline).getTime()) / MS_PER_DAY,
    );
    const amountDelta = BigInt(target.amountBaseUnits) - BigInt(base.amountBaseUnits);
    const criteriaDiffs = diffCriteria(base.criteria, target.criteria);

    const hasCriteriaChanges = criteriaDiffs.some((c) => c.type !== "UNCHANGED");
    const isModified =
      target.title !== base.title ||
      deadlineShift !== 0 ||
      amountDelta !== 0n ||
      hasCriteriaChanges;

    diffs.push({
      milestoneId: target.onchainMilestoneId,
      title: target.title,
      type: isModified ? "MODIFIED" : "UNCHANGED",
      deadlineShiftDays: deadlineShift,
      amountDeltaBaseUnits: amountDelta.toString(),
      criteriaDiffs,
    });
  }

  // Check removed base milestones
  for (const base of baseMilestones) {
    if (!targetMap.has(base.onchainMilestoneId)) {
      diffs.push({
        milestoneId: base.onchainMilestoneId,
        title: base.title,
        type: "REMOVED",
        deadlineShiftDays: 0,
        amountDeltaBaseUnits: (-BigInt(base.amountBaseUnits)).toString(),
        criteriaDiffs: base.criteria.map((c) => ({ type: "REMOVED", criterion: c })),
      });
    }
  }

  return diffs;
};

export const computeScopeGuardReport = (
  publicProjectId: string,
  base: VersionInfo,
  target: VersionInfo,
): ScopeGuardReport => {
  const baseTerms = JSON.parse(base.criteriaJson) as AgreementTerms;
  const targetTerms = JSON.parse(target.criteriaJson) as AgreementTerms;

  const milestoneDiffs = diffMilestones(baseTerms.milestones, targetTerms.milestones);
  const hasChanges = milestoneDiffs.some((m) => m.type !== "UNCHANGED");

  let totalAmountDelta = 0n;
  let maxDeadlineShift = 0;
  let baseTotalAmount = 0n;

  for (const m of baseTerms.milestones) {
    baseTotalAmount += BigInt(m.amountBaseUnits);
  }

  for (const diff of milestoneDiffs) {
    totalAmountDelta += BigInt(diff.amountDeltaBaseUnits);
    if (Math.abs(diff.deadlineShiftDays) > Math.abs(maxDeadlineShift)) {
      maxDeadlineShift = diff.deadlineShiftDays;
    }
  }

  // Assess timeline risk
  let timelineRisk: RiskLevel = "LOW";
  if (maxDeadlineShift > 14) {
    timelineRisk = "HIGH";
  } else if (maxDeadlineShift > 3) {
    timelineRisk = "MEDIUM";
  }

  // Assess cost risk
  let costRisk: RiskLevel = "LOW";
  if (baseTotalAmount > 0n && totalAmountDelta > 0n) {
    const pctIncrease = Number((totalAmountDelta * 100n) / baseTotalAmount);
    if (pctIncrease > 50) {
      costRisk = "HIGH";
    } else if (pctIncrease > 20) {
      costRisk = "MEDIUM";
    }
  } else if (totalAmountDelta < 0n) {
    costRisk = "LOW";
  }

  // Overall risk
  let overallRisk: RiskLevel = "LOW";
  if (timelineRisk === "HIGH" || costRisk === "HIGH") {
    overallRisk = "HIGH";
  } else if (timelineRisk === "MEDIUM" || costRisk === "MEDIUM") {
    overallRisk = "MEDIUM";
  } else if (hasChanges) {
    overallRisk = "LOW";
  }

  const clientAccepted = target.clientAcceptedAt !== null;
  const freelancerAccepted = target.freelancerAcceptedAt !== null;
  const isFullyAccepted = clientAccepted && freelancerAccepted;

  const addedCount = milestoneDiffs.filter((m) => m.type === "ADDED").length;
  const modifiedCount = milestoneDiffs.filter((m) => m.type === "MODIFIED").length;
  const removedCount = milestoneDiffs.filter((m) => m.type === "REMOVED").length;

  let summary = "No scope changes detected.";
  if (hasChanges) {
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`${addedCount} added milestone(s)`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified milestone(s)`);
    if (removedCount > 0) parts.push(`${removedCount} removed milestone(s)`);
    if (maxDeadlineShift !== 0) parts.push(`timeline shift of ${maxDeadlineShift} days`);
    if (totalAmountDelta !== 0n) parts.push(`budget shift of ${totalAmountDelta.toString()} base units`);
    summary = `Scope change detected: ${parts.join(", ")}. Approval status: ${
      isFullyAccepted ? "Accepted by both parties" : "Pending acceptance"
    }.`;
  }

  return {
    publicProjectId,
    baseVersion: base.version,
    targetVersion: target.version,
    hasChanges,
    milestoneDiffs,
    totalAmountDeltaBaseUnits: totalAmountDelta.toString(),
    totalDeadlineShiftDays: maxDeadlineShift,
    timelineRisk,
    costRisk,
    overallRisk,
    approvalStatus: {
      clientAccepted,
      freelancerAccepted,
      isFullyAccepted,
    },
    summary,
  };
};
