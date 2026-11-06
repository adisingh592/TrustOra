/**
 * Which actions a wallet can take on a project right now, and why an action is unavailable.
 * Pure (no React, no network) so the rules the UI shows are unit-tested. The server and the contract
 * remain the real enforcement; this only avoids offering actions that are certain to be refused.
 */
import type { ProjectRole } from "./authz";

export type ActionId =
  | "accept_agreement"
  | "register_project"
  | "register_milestone"
  | "approve_usdc"
  | "fund"
  | "submit"
  | "evaluate"
  | "request_revision"
  | "release"
  | "dispute"
  | "refund"
  | "resolve";

export interface WorkflowMilestone {
  id: string;
  milestoneIndex: number;
  state: string;
  amountUsdc: number;
  addTxHash: string | null;
}

export interface WorkflowProject {
  status: string;
  registerTxHash: string | null;
  agreement: { clientAccepted: boolean; freelancerAccepted: boolean; isLocked: boolean } | null;
  milestones: WorkflowMilestone[];
}

export interface WalletContext {
  roles: ProjectRole[];
  /** ESCROW_CONTRACT_ADDRESS is configured on the server. */
  escrowConfigured: boolean;
  connected: boolean;
  onArc: boolean;
  /** USDC allowance granted to the escrow by the connected wallet, in base units; null while unknown. */
  allowanceUnits: bigint | null;
  /** Milestone amount in base units (caller converts with toUsdcBaseUnits). */
  amountUnits: bigint;
}

export interface ActionAvailability {
  id: ActionId;
  /** Who this action belongs to. */
  role: ProjectRole;
  available: boolean;
  /** Human-readable reason shown when the action is not available. */
  reason?: string;
}

const OPEN_STATES = ["FUNDED", "SUBMITTED", "REVISION_REQUESTED"];

/** Actions relevant to one milestone for the viewing wallet. Available and blocked ones are both returned. */
export function milestoneActions(project: WorkflowProject, m: WorkflowMilestone, w: WalletContext): ActionAvailability[] {
  const out: ActionAvailability[] = [];
  const chainBlock = (): string | undefined => {
    if (!w.escrowConfigured) return "The escrow contract address is not configured on the server yet";
    if (!w.connected) return "Connect your wallet";
    if (!w.onArc) return "Switch your wallet to Arc Testnet";
    return undefined;
  };
  const add = (id: ActionId, role: ProjectRole, ok: boolean, why: string | undefined) => {
    const reason = why ?? chainBlock();
    out.push({ id, role, available: ok && !reason, reason: ok ? reason : why });
  };
  const locked = !!project.agreement?.isLocked;
  const registered = !!project.registerTxHash;
  const milestoneRegistered = !!m.addTxHash;

  if (w.roles.includes("client")) {
    const earlierUnregistered = project.milestones.some((x) => x.milestoneIndex < m.milestoneIndex && !x.addTxHash);
    add(
      "register_milestone", "client",
      locked && registered && !milestoneRegistered && !earlierUnregistered,
      !locked ? "Waiting for the freelancer to accept the agreement"
        : !registered ? "Register the project on Arc first"
        : milestoneRegistered ? "Already registered on Arc"
        : earlierUnregistered ? "Register earlier milestones first (the contract numbers them in order)"
        : undefined,
    );
    const canFundNow = m.state === "UNFUNDED" && milestoneRegistered;
    const needsApproval = w.allowanceUnits === null || w.allowanceUnits < w.amountUnits;
    add(
      "approve_usdc", "client",
      canFundNow && needsApproval,
      m.state !== "UNFUNDED" ? "Milestone is already funded"
        : !milestoneRegistered ? "Register this milestone on Arc first"
        : !needsApproval ? "USDC spending already approved for this amount"
        : undefined,
    );
    add(
      "fund", "client",
      canFundNow && !needsApproval,
      m.state !== "UNFUNDED" ? "Milestone is already funded"
        : !milestoneRegistered ? "Register this milestone on Arc first"
        : needsApproval ? "Approve USDC spending first"
        : undefined,
    );
    add("evaluate", "client", m.state === "SUBMITTED", m.state === "SUBMITTED" ? undefined : "Needs submitted work");
    add("request_revision", "client", m.state === "SUBMITTED", m.state === "SUBMITTED" ? undefined : "Needs submitted work");
    add("release", "client", m.state === "SUBMITTED", m.state === "SUBMITTED" ? undefined : "Funds can be released once work is submitted");
    add("dispute", "client", OPEN_STATES.includes(m.state), OPEN_STATES.includes(m.state) ? undefined : "Nothing to dispute in this state");
  }

  if (w.roles.includes("freelancer")) {
    const canSubmit = m.state === "FUNDED" || m.state === "REVISION_REQUESTED";
    add("submit", "freelancer", canSubmit, canSubmit ? undefined : m.state === "UNFUNDED" ? "Waiting for the client to fund this milestone" : "Work cannot be submitted in this state");
    add("dispute", "freelancer", OPEN_STATES.includes(m.state), OPEN_STATES.includes(m.state) ? undefined : "Nothing to dispute in this state");
    add("refund", "freelancer", OPEN_STATES.includes(m.state), OPEN_STATES.includes(m.state) ? undefined : "Nothing in escrow to refund");
  }

  if (w.roles.includes("arbiter")) {
    add("resolve", "arbiter", m.state === "DISPUTED", m.state === "DISPUTED" ? undefined : "No open dispute");
  }
  return out;
}

/** Project-level actions: freelancer acceptance and createProject registration. */
export function projectActions(project: WorkflowProject, w: WalletContext): ActionAvailability[] {
  const out: ActionAvailability[] = [];
  const chainBlock = (): string | undefined => {
    if (!w.escrowConfigured) return "The escrow contract address is not configured on the server yet";
    if (!w.connected) return "Connect your wallet";
    if (!w.onArc) return "Switch your wallet to Arc Testnet";
    return undefined;
  };
  if (w.roles.includes("freelancer")) {
    const accepted = !!project.agreement?.freelancerAccepted;
    out.push({
      id: "accept_agreement", role: "freelancer", available: !accepted && w.connected,
      reason: accepted ? "You already accepted this agreement" : !w.connected ? "Connect your wallet" : undefined,
    });
  }
  if (w.roles.includes("client")) {
    const locked = !!project.agreement?.isLocked;
    const registered = !!project.registerTxHash;
    const why = !locked ? "Waiting for the freelancer to accept the agreement" : registered ? "Already registered on Arc" : undefined;
    const block = chainBlock();
    out.push({ id: "register_project", role: "client", available: locked && !registered && !block, reason: why ?? block });
  }
  return out;
}

export interface NextStepProject {
  registerTxHash: string | null;
  agreement: { freelancerAccepted: boolean; isLocked: boolean } | null;
  milestones: Array<{ state: string }>;
}

/** The single most useful thing this wallet can do next on a project, or null when it is waiting on someone else. */
export function nextStepFor(project: NextStepProject, roles: ProjectRole[]): { text: string; tab: ProjectRole } | null {
  const a = project.agreement;
  if (roles.includes("freelancer") && a && !a.freelancerAccepted) return { text: "Review the criteria and sign the agreement.", tab: "freelancer" };
  if (roles.includes("client")) {
    if (a?.isLocked && !project.registerTxHash) return { text: "Register the project on Arc from your wallet.", tab: "client" };
    if (project.milestones.some((m) => m.state === "SUBMITTED")) return { text: "Work was submitted. Review it and release funds or request a revision.", tab: "client" };
    if (project.registerTxHash && project.milestones.some((m) => m.state === "UNFUNDED")) return { text: "Register, approve and fund the next milestone.", tab: "client" };
  }
  if (roles.includes("freelancer") && project.milestones.some((m) => m.state === "FUNDED" || m.state === "REVISION_REQUESTED")) {
    return { text: "A milestone is funded. Submit your deliverable.", tab: "freelancer" };
  }
  if (roles.includes("arbiter") && project.milestones.some((m) => m.state === "DISPUTED")) return { text: "A dispute needs your resolution.", tab: "arbiter" };
  return null;
}

/** One plain-language line telling each role where a milestone stands and who acts next. */
export function statusNote(state: string, role: ProjectRole): string {
  const notes: Record<ProjectRole, Record<string, string>> = {
    client: {
      UNFUNDED: "Register this milestone on Arc, approve USDC spending, then fund it.",
      FUNDED: "Funded in escrow. Waiting for the freelancer to submit work.",
      SUBMITTED: "Work submitted. Review it, then release funds, request a revision or open a dispute.",
      REVISION_REQUESTED: "Revision requested. Waiting for the freelancer to resubmit.",
      DISPUTED: "In dispute. Waiting for the arbiter to resolve it.",
      RELEASED: "Funds were released to the freelancer.",
      REFUNDED: "The escrowed funds were refunded to you.",
    },
    freelancer: {
      UNFUNDED: "Waiting for the client to register and fund this milestone.",
      FUNDED: "Funded in escrow. Submit your deliverable when it is ready.",
      SUBMITTED: "Submitted. Waiting for the client to review it.",
      REVISION_REQUESTED: "The client asked for changes. Submit a revised deliverable.",
      DISPUTED: "In dispute. Waiting for the arbiter to resolve it.",
      RELEASED: "Funds were released to you.",
      REFUNDED: "The escrowed funds were refunded to the client.",
    },
    arbiter: {
      DISPUTED: "A dispute is open. Split the escrowed USDC between the parties.",
    },
  };
  return notes[role][state] ?? (role === "arbiter" ? "No open dispute on this milestone." : "No action is needed right now.");
}
