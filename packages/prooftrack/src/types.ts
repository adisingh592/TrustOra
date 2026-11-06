import type {
  Ecosystem,
  ProofEventExpected,
  ProofEventType,
  ReferenceType,
  VerificationStatus,
} from "@trustora/shared";

/** An event as ProofTrack stores it. `expected` is server-side only. */
export interface StoredEvent {
  id: string;
  publicProjectId: string;
  milestoneId: string | null;
  occurredAt: Date;
  createdAt: Date;
  ecosystem: Ecosystem;
  network: string;
  chainId: number | null;
  eventType: ProofEventType;
  referenceType: ReferenceType;
  referenceValue: string;
  verificationStatus: VerificationStatus;
  statusReason: string | null;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  summary: string;
  expected: ProofEventExpected;
}

export type NewEvent = Omit<StoredEvent, "id">;

export interface VerificationUpdate {
  verificationStatus: VerificationStatus;
  statusReason: string | null;
  lastCheckedAt: Date;
  verifiedAt: Date | null;
}

export interface NaturalKey {
  referenceType: ReferenceType;
  referenceValue: string;
  eventType: ProofEventType;
}

/** Thrown by EventStore.insert when the natural key already exists. */
export class DuplicateEventError extends Error {
  constructor() {
    super("This event already exists.");
    this.name = "DuplicateEventError";
  }
}

export interface EventStore {
  /** Throws DuplicateEventError if the natural key already exists. */
  insert(event: NewEvent): Promise<StoredEvent>;
  findByNaturalKey(key: NaturalKey): Promise<StoredEvent | null>;
  listByProject(publicProjectId: string): Promise<StoredEvent[]>;
  getById(id: string): Promise<StoredEvent | null>;
  /** Changes verification fields only. A reference can never be rewritten. */
  updateVerification(id: string, update: VerificationUpdate): Promise<StoredEvent>;
}

export type VerifierOutcome = "MATCH" | "MISMATCH" | "UNAVAILABLE";

export interface VerifierResult {
  outcome: VerifierOutcome;
  reason?: string;
  checkedAt: Date;
}

export type Verifier = (event: StoredEvent) => Promise<VerifierResult>;

export type VerifierKey = `${Ecosystem}:${ReferenceType}`;

/** Verifiers by ecosystem and reference type. A missing entry means no check exists. */
export type Verifiers = ReadonlyMap<VerifierKey, Verifier>;

/** One entry in the public timeline. Holds no `expected` data. */
export interface TimelineItem {
  id: string;
  type: ProofEventType;
  ecosystem: Ecosystem;
  network: string;
  referenceType: ReferenceType;
  reference: string;
  status: VerificationStatus;
  statusReason: string | null;
  lastCheckedAt: string | null;
  occurredAt: string;
  explorerUrl: string | null;
  summary: string;
}

export type ProofTrackErrorCode =
  | "INVALID_INPUT"
  | "REFERENCE_TYPE_MISMATCH"
  | "INVALID_REFERENCE"
  | "WRONG_CHAIN"
  | "REFERENCE_ALREADY_USED"
  | "EVENT_NOT_FOUND";

export class ProofTrackError extends Error {
  constructor(
    readonly code: ProofTrackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProofTrackError";
  }
}
