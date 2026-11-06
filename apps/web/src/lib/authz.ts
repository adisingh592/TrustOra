/**
 * Authorization policy (pure). Identity comes only from the authenticated session wallet.
 * A role is never read from a request body: it is derived by comparing the session wallet
 * with the parties stored on the project.
 */
import type { EscrowAction } from "./escrow-sync";

export type ProjectRole = "client" | "freelancer" | "arbiter";

export interface ProjectParties {
  clientAddress: string;
  freelancerAddress: string | null;
  arbiterAddress: string | null;
}

const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Roles the wallet holds on this project. Empty when it is not a participant. */
export function rolesOf(wallet: string, project: ProjectParties): ProjectRole[] {
  const roles: ProjectRole[] = [];
  if (same(project.clientAddress, wallet)) roles.push("client");
  if (same(project.freelancerAddress, wallet)) roles.push("freelancer");
  if (same(project.arbiterAddress, wallet)) roles.push("arbiter");
  return roles;
}

/** Which roles may submit each escrow action's transaction hash for sync. */
export const ACTION_ROLES: Record<EscrowAction, ProjectRole[]> = {
  fund: ["client"],
  release: ["client"],
  revision: ["client"],
  submit: ["freelancer"],
  refund: ["freelancer"],
  dispute: ["client", "freelancer"],
  // The authoritative arbiter is whoever the contract stores (the owner by default). The sync step
  // verifies the transaction sender against the contract; here only project participants may submit it.
  resolve: ["client", "freelancer", "arbiter"],
};

export function canPerform(wallet: string, project: ProjectParties, allowed: ProjectRole[]): boolean {
  return rolesOf(wallet, project).some((r) => allowed.includes(r));
}

export function isParticipant(wallet: string, project: ProjectParties): boolean {
  return rolesOf(wallet, project).length > 0;
}
