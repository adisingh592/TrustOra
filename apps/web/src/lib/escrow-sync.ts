/**
 * Chain-verified escrow synchronization (pure logic: no database, no direct network).
 *
 * The chain is the authority. The browser wallet signs and sends every fund-moving transaction;
 * this module only VERIFIES a transaction hash a user reports. A hash is never trusted on its own:
 * we load the receipt, require success, require it was sent to the configured escrow contract,
 * decode the escrow's own event logs for the exact project + milestone, check the sender holds the
 * required role on-chain, and read the milestone state from the contract before anything is recorded.
 * Nothing here can sign or send a transaction.
 */
import { decodeEventLog } from "viem";
import {
  CHAIN_MILESTONE_STATES,
  DB_STATE_BY_CHAIN_STATE,
  TRUSTORA_ESCROW_ABI,
  criteriaHashToBytes32,
  projectIdToBytes32,
  toUsdcBaseUnits,
  type Hex,
} from "../../../../packages/contracts/src/lib/arc";

export type EscrowAction = "fund" | "submit" | "release" | "revision" | "dispute" | "refund" | "resolve";
export type EscrowRole = "client" | "freelancer" | "arbiter";

export const ESCROW_ACTIONS: Record<EscrowAction, { event: string; senders: EscrowRole[]; proofEventType: string }> = {
  fund: { event: "MilestoneFunded", senders: ["client"], proofEventType: "ESCROW_FUNDED" },
  submit: { event: "MilestoneSubmitted", senders: ["freelancer"], proofEventType: "ESCROW_WORK_SUBMITTED" },
  release: { event: "MilestoneReleased", senders: ["client"], proofEventType: "ESCROW_RELEASED" },
  revision: { event: "RevisionRequested", senders: ["client"], proofEventType: "ESCROW_REVISION_REQUESTED" },
  dispute: { event: "MilestoneDisputed", senders: ["client", "freelancer"], proofEventType: "ESCROW_DISPUTED" },
  refund: { event: "MilestoneRefunded", senders: ["freelancer"], proofEventType: "ESCROW_REFUNDED" },
  resolve: { event: "DisputeResolved", senders: ["arbiter"], proofEventType: "ESCROW_DISPUTE_RESOLVED" },
};

export type EscrowSyncErrorCode =
  | "ESCROW_NOT_CONFIGURED"
  | "INVALID_TX_HASH"
  | "RECEIPT_NOT_FOUND"
  | "CHAIN_READ_FAILED"
  | "TX_REVERTED"
  | "WRONG_CONTRACT"
  | "EVENT_NOT_FOUND"
  | "PROJECT_NOT_ON_CHAIN"
  | "PARTY_MISMATCH"
  | "SENDER_NOT_AUTHORIZED"
  | "CRITERIA_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "DELIVERABLE_MISMATCH"
  | "CHAIN_STATE_BEHIND"
  | "INVALID_TRANSITION";

const HTTP_STATUS: Record<EscrowSyncErrorCode, number> = {
  ESCROW_NOT_CONFIGURED: 503,
  INVALID_TX_HASH: 400,
  RECEIPT_NOT_FOUND: 409, // not mined yet: caller may retry
  CHAIN_READ_FAILED: 502,
  TX_REVERTED: 422,
  WRONG_CONTRACT: 422,
  EVENT_NOT_FOUND: 422,
  PROJECT_NOT_ON_CHAIN: 409,
  PARTY_MISMATCH: 409,
  SENDER_NOT_AUTHORIZED: 403,
  CRITERIA_MISMATCH: 409,
  AMOUNT_MISMATCH: 409,
  DELIVERABLE_MISMATCH: 409,
  CHAIN_STATE_BEHIND: 409, // node has not caught up to the tx's block: caller may retry
  INVALID_TRANSITION: 409,
};

export class EscrowSyncError extends Error {
  readonly httpStatus: number;
  constructor(readonly code: EscrowSyncErrorCode, message: string) {
    super(message);
    this.name = "EscrowSyncError";
    this.httpStatus = HTTP_STATUS[code];
  }
}

// ---- Minimal chain-reader surface (viem's PublicClient satisfies this; tests mock it) ----

export interface ReceiptLike {
  status: "success" | "reverted";
  from: string;
  to: string | null;
  blockNumber: bigint;
  logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }>;
}

export interface ChainReader {
  getTransactionReceipt(args: { hash: Hex }): Promise<ReceiptLike>;
  readContract(args: {
    address: Hex;
    abi: typeof TRUSTORA_ESCROW_ABI;
    functionName: "getProject" | "getMilestone";
    args: readonly unknown[];
  }): Promise<unknown>;
}

interface ChainProject {
  client: string;
  freelancer: string;
  arbiter: string;
  exists: boolean;
}
interface ChainMilestone {
  criteriaHash: string;
  amount: bigint;
  state: number | bigint;
  deliverableHash: string;
  deliverableUri: string;
}

/** What the database believes about the project and milestone being synced. */
export interface ExpectedEscrowContext {
  /** DB Project.id, e.g. TRU-PROJ-2026-0001042 */
  projectId: string;
  /** DB Milestone.milestoneIndex == on-chain milestoneId */
  milestoneIndex: number;
  clientAddress: string;
  freelancerAddress: string | null;
  arbiterAddress: string | null;
  /** DB criteria hash (64 hex chars, with or without 0x) */
  criteriaHash: string;
  /** DB milestone amount in USDC (decimal) */
  amountUsdc: number | string;
  /** For `submit`: the SHA-256 (hex) of the DB submission the freelancer says they anchored. */
  expectedDeliverableHash?: string;
}

export interface VerifiedEscrowTx {
  action: EscrowAction;
  txHash: Hex;
  blockNumber: bigint;
  sender: string;
  senderRole: EscrowRole;
  /** DB-style milestone state taken from the contract (e.g. "FUNDED"), not inferred from the tx. */
  dbState: string;
  chainState: string;
  eventArgs: Record<string, unknown>;
  chain: { amount: bigint; deliverableHash: string; deliverableUri: string };
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The milestone state(s) each action's event leaves the contract in. Later states are fine; earlier ones are not. */
const RESULT_STATES: Record<EscrowAction, string[]> = {
  fund: ["FUNDED"],
  submit: ["SUBMITTED"],
  revision: ["REVISION_REQUESTED"],
  dispute: ["DISPUTED"],
  release: ["RELEASED"],
  refund: ["REFUNDED"],
  resolve: ["RELEASED", "REFUNDED"],
};

/** Verifies a user-reported transaction hash against Arc and returns what the chain proves. */
export async function verifyEscrowTx(
  reader: ChainReader,
  params: { txHash: string; escrowAddress: string | null; action: EscrowAction; expected: ExpectedEscrowContext },
): Promise<VerifiedEscrowTx> {
  const { action, expected } = params;
  const spec = ESCROW_ACTIONS[action];
  const projectKey = projectIdToBytes32(expected.projectId);

  // 1-2. Receipt must be a successful tx to OUR escrow, carrying the right event for this project + milestone.
  const { receipt, args: eventArgs, escrow, txHash } = await loadEscrowEvent(reader, {
    txHash: params.txHash,
    escrowAddress: params.escrowAddress,
    eventName: spec.event,
    projectKey,
    milestoneId: BigInt(expected.milestoneIndex),
  });

  // 3. Authoritative parties from the contract; they must agree with the database.
  const chainProject = await readChain<ChainProject>(reader, escrow, "getProject", [projectKey]);
  if (!chainProject.exists) {
    throw new EscrowSyncError("PROJECT_NOT_ON_CHAIN", "Project is not registered on the escrow contract");
  }
  if (!eq(chainProject.client, expected.clientAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain client differs from the project's client");
  }
  if (!expected.freelancerAddress || !eq(chainProject.freelancer, expected.freelancerAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain freelancer differs from (or is missing in) the project record");
  }
  if (expected.arbiterAddress && !eq(chainProject.arbiter, expected.arbiterAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain arbiter differs from the project's arbiter");
  }

  // 4. The sender must hold the role this action requires on-chain.
  const roleAddress: Record<EscrowRole, string> = {
    client: chainProject.client,
    freelancer: chainProject.freelancer,
    arbiter: chainProject.arbiter,
  };
  const senderRole = spec.senders.find((r) => eq(receipt.from, roleAddress[r]));
  if (!senderRole) {
    throw new EscrowSyncError(
      "SENDER_NOT_AUTHORIZED",
      `Transaction sender is not the on-chain ${spec.senders.join(" or ")} for this action`,
    );
  }

  // 5. Current milestone state and terms, read from the contract.
  const chainMilestone = await readChain<ChainMilestone>(reader, escrow, "getMilestone", [
    projectKey,
    BigInt(expected.milestoneIndex),
  ]);
  if (!eq(chainMilestone.criteriaHash, criteriaHashToBytes32(expected.criteriaHash))) {
    throw new EscrowSyncError("CRITERIA_MISMATCH", "On-chain criteria hash differs from the locked agreement");
  }
  let expectedAmount: bigint;
  try {
    expectedAmount = toUsdcBaseUnits(expected.amountUsdc);
  } catch {
    throw new EscrowSyncError("AMOUNT_MISMATCH", "Milestone amount in the database is not a valid USDC amount");
  }
  if (BigInt(chainMilestone.amount) !== expectedAmount) {
    throw new EscrowSyncError("AMOUNT_MISMATCH", "On-chain milestone amount differs from the database amount");
  }
  if (action === "submit") {
    if (!expected.expectedDeliverableHash) {
      throw new EscrowSyncError("DELIVERABLE_MISMATCH", "No stored submission to compare the anchored deliverable hash with");
    }
    const anchored = String(eventArgs.deliverableHash ?? "");
    if (!eq(anchored, criteriaHashToBytes32(expected.expectedDeliverableHash))) {
      throw new EscrowSyncError("DELIVERABLE_MISMATCH", "Anchored deliverable hash differs from the stored submission");
    }
  }

  const chainStateName = CHAIN_MILESTONE_STATES[Number(chainMilestone.state)];
  if (!chainStateName) {
    throw new EscrowSyncError("CHAIN_READ_FAILED", "Contract returned an unknown milestone state");
  }
  // The tx's event proves the contract reached (at least) this action's resulting state. If the state we
  // read is not that state or a later one, the RPC node is behind or inconsistent: never record it as verified.
  const reached = DB_STATE_BY_CHAIN_STATE[chainStateName];
  if (!RESULT_STATES[action].some((r) => r === reached || isReachableDbState(r, reached))) {
    throw new EscrowSyncError(
      "CHAIN_STATE_BEHIND",
      `Contract reports ${chainStateName}, which does not reflect the ${action} transaction yet; retry shortly`,
    );
  }

  return {
    action,
    txHash,
    blockNumber: receipt.blockNumber,
    sender: receipt.from,
    senderRole,
    dbState: DB_STATE_BY_CHAIN_STATE[chainStateName],
    chainState: chainStateName,
    eventArgs,
    chain: {
      amount: BigInt(chainMilestone.amount),
      deliverableHash: chainMilestone.deliverableHash,
      deliverableUri: chainMilestone.deliverableUri,
    },
  };
}

/**
 * Shared by every verification path: validates inputs, loads the receipt, requires success and that the
 * tx was sent to the configured escrow, then finds the escrow's own event for this exact project (and milestone).
 */
async function loadEscrowEvent(
  reader: ChainReader,
  p: { txHash: string; escrowAddress: string | null; eventName: string; projectKey: Hex; milestoneId?: bigint },
): Promise<{ receipt: ReceiptLike; args: Record<string, unknown>; escrow: Hex; txHash: Hex }> {
  if (!p.escrowAddress) {
    throw new EscrowSyncError("ESCROW_NOT_CONFIGURED", "ESCROW_CONTRACT_ADDRESS is not configured on the server");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(p.txHash)) {
    throw new EscrowSyncError("INVALID_TX_HASH", "txHash must be a 32-byte hex string");
  }
  const txHash = p.txHash as Hex;
  const escrow = p.escrowAddress as Hex;

  let receipt: ReceiptLike;
  try {
    receipt = await reader.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (/ReceiptNotFound|NotFound/i.test(name)) {
      throw new EscrowSyncError("RECEIPT_NOT_FOUND", "Transaction receipt not found yet; retry after it is mined");
    }
    throw new EscrowSyncError("CHAIN_READ_FAILED", "Could not read the transaction receipt from Arc");
  }
  if (receipt.status !== "success") {
    throw new EscrowSyncError("TX_REVERTED", "Transaction reverted on-chain");
  }
  if (!receipt.to || !eq(receipt.to, escrow)) {
    throw new EscrowSyncError("WRONG_CONTRACT", "Transaction was not sent to the configured escrow contract");
  }

  for (const log of receipt.logs) {
    if (!eq(log.address, escrow)) continue;
    let decoded: { eventName?: string; args?: unknown };
    try {
      decoded = decodeEventLog({
        abi: TRUSTORA_ESCROW_ABI,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      }) as { eventName?: string; args?: unknown };
    } catch {
      continue; // not an escrow event we know
    }
    if (decoded.eventName !== p.eventName) continue;
    const args = decoded.args as Record<string, unknown>;
    if (typeof args.projectId !== "string" || !eq(args.projectId, p.projectKey)) continue;
    if (p.milestoneId !== undefined && BigInt(args.milestoneId as bigint) !== p.milestoneId) continue;
    return { receipt, args, escrow, txHash };
  }
  throw new EscrowSyncError("EVENT_NOT_FOUND", `No ${p.eventName} event for this project${p.milestoneId !== undefined ? " and milestone" : ""} in the transaction`);
}

async function readChain<T>(
  reader: ChainReader,
  address: Hex,
  functionName: "getProject" | "getMilestone",
  args: readonly unknown[],
): Promise<T> {
  try {
    return (await reader.readContract({ address, abi: TRUSTORA_ESCROW_ABI, functionName, args })) as T;
  } catch {
    throw new EscrowSyncError("CHAIN_READ_FAILED", `Could not read ${functionName} from the escrow contract`);
  }
}

// ---- On-chain registration (createProject / addMilestone) ----

export interface ExpectedRegistration {
  projectId: string;
  clientAddress: string;
  freelancerAddress: string | null;
  /** DB arbiter; null means "contract default" and the on-chain arbiter is adopted. */
  arbiterAddress: string | null;
  /** For kind "milestone" */
  milestoneIndex?: number;
  criteriaHash?: string;
  amountUsdc?: number | string;
}

export interface VerifiedRegistration {
  kind: "project" | "milestone";
  txHash: Hex;
  blockNumber: bigint;
  sender: string;
  chainArbiter: string;
}

/**
 * Verifies createProject / addMilestone. The DB record alone never implies the project exists on-chain:
 * this proves it from the receipt, the event, and the contract's own stored project.
 */
export async function verifyRegistrationTx(
  reader: ChainReader,
  params: { txHash: string; escrowAddress: string | null; kind: "project" | "milestone"; expected: ExpectedRegistration },
): Promise<VerifiedRegistration> {
  const { kind, expected } = params;
  const projectKey = projectIdToBytes32(expected.projectId);
  const isMilestone = kind === "milestone";
  if (isMilestone && (expected.milestoneIndex === undefined || !expected.criteriaHash || expected.amountUsdc === undefined)) {
    throw new EscrowSyncError("CRITERIA_MISMATCH", "Milestone registration needs index, criteria hash and amount");
  }

  const { receipt, args, escrow, txHash } = await loadEscrowEvent(reader, {
    txHash: params.txHash,
    escrowAddress: params.escrowAddress,
    eventName: isMilestone ? "MilestoneAdded" : "ProjectCreated",
    projectKey,
    milestoneId: isMilestone ? BigInt(expected.milestoneIndex!) : undefined,
  });

  const chainProject = await readChain<ChainProject>(reader, escrow, "getProject", [projectKey]);
  if (!chainProject.exists) {
    throw new EscrowSyncError("PROJECT_NOT_ON_CHAIN", "Project is not registered on the escrow contract");
  }
  if (!eq(chainProject.client, expected.clientAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain client differs from the project's client");
  }
  if (!expected.freelancerAddress || !eq(chainProject.freelancer, expected.freelancerAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain freelancer differs from (or is missing in) the project record");
  }
  if (expected.arbiterAddress && !eq(chainProject.arbiter, expected.arbiterAddress)) {
    throw new EscrowSyncError("PARTY_MISMATCH", "On-chain arbiter differs from the project's arbiter");
  }
  // createProject/addMilestone are client-only on-chain; require the sender to be that client.
  if (!eq(receipt.from, chainProject.client)) {
    throw new EscrowSyncError("SENDER_NOT_AUTHORIZED", "Transaction sender is not the on-chain client");
  }

  if (isMilestone) {
    if (!eq(String(args.criteriaHash), criteriaHashToBytes32(expected.criteriaHash!))) {
      throw new EscrowSyncError("CRITERIA_MISMATCH", "On-chain criteria hash differs from the locked agreement");
    }
    let expectedAmount: bigint;
    try {
      expectedAmount = toUsdcBaseUnits(expected.amountUsdc!);
    } catch {
      throw new EscrowSyncError("AMOUNT_MISMATCH", "Milestone amount in the database is not a valid USDC amount");
    }
    if (BigInt(args.amount as bigint) !== expectedAmount) {
      throw new EscrowSyncError("AMOUNT_MISMATCH", "On-chain milestone amount differs from the database amount");
    }
    const chainMilestone = await readChain<ChainMilestone>(reader, escrow, "getMilestone", [projectKey, BigInt(expected.milestoneIndex!)]);
    if (BigInt(chainMilestone.amount) !== expectedAmount || !eq(chainMilestone.criteriaHash, criteriaHashToBytes32(expected.criteriaHash!))) {
      throw new EscrowSyncError("AMOUNT_MISMATCH", "Contract milestone record differs from the database");
    }
  }

  return { kind, txHash, blockNumber: receipt.blockNumber, sender: receipt.from, chainArbiter: chainProject.arbiter };
}

// ---- Database state transitions (mirror of the contract state machine) ----

const NEXT_DB_STATES: Record<string, string[]> = {
  UNFUNDED: ["FUNDED"],
  FUNDED: ["SUBMITTED", "RELEASED", "DISPUTED", "REFUNDED"],
  SUBMITTED: ["REVISION_REQUESTED", "RELEASED", "DISPUTED", "REFUNDED"],
  REVISION_REQUESTED: ["SUBMITTED", "DISPUTED", "REFUNDED"],
  DISPUTED: ["RELEASED", "REFUNDED"],
  APPROVED: ["RELEASED"],
  RELEASED: [],
  REFUNDED: [],
};

/** True if `to` can be reached from `from` through one or more contract transitions (a sync may have been missed). */
export function isReachableDbState(from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [...(NEXT_DB_STATES[from] ?? [])];
  while (stack.length) {
    const s = stack.pop()!;
    if (s === to) return true;
    if (seen.has(s)) continue;
    seen.add(s);
    stack.push(...(NEXT_DB_STATES[s] ?? []));
  }
  return false;
}

/**
 * Decides how to move the DB milestone to the chain-reported state.
 * Same state -> idempotent no-op. Reachable forward -> advance. Otherwise the DB and chain disagree
 * in a way a legitimate sequence of transactions cannot produce -> reject, never overwrite.
 */
export function planDbTransition(current: string, chainDbState: string): "NOOP" | "ADVANCE" {
  if (current === chainDbState) return "NOOP";
  if (isReachableDbState(current, chainDbState)) return "ADVANCE";
  throw new EscrowSyncError(
    "INVALID_TRANSITION",
    `Database state ${current} cannot move to on-chain state ${chainDbState}`,
  );
}

/** Project status derived from its milestones' (chain-synced) states. */
export function deriveProjectStatus(current: string, milestoneStates: string[]): string {
  if (milestoneStates.length === 0) return current;
  if (milestoneStates.some((s) => s === "DISPUTED")) return "DISPUTED";
  if (milestoneStates.every((s) => s === "RELEASED" || s === "REFUNDED")) return "COMPLETED";
  if (milestoneStates.some((s) => s === "SUBMITTED" || s === "REVISION_REQUESTED" || s === "RELEASED" || s === "REFUNDED")) {
    return "IN_PROGRESS";
  }
  if (milestoneStates.some((s) => s === "FUNDED")) return "FUNDED";
  return current;
}
