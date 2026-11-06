// FIXTURES ONLY. Sample data for building and testing. Nothing here is real:
// no transaction, inference, settlement or payment in this file ever happened.
// Fixtures stay PENDING, with no verifiedAt or explorerUrl, so that none of them
// can read as verified proof.
import { ARC_TESTNET_CHAIN_ID } from "./constants.js";
import type { Ecosystem, ReferenceType } from "./enums.js";
import type { ProofEvent, ProofEventType } from "./proofevent.js";

export interface Fixture<T> {
  isFixture: true;
  data: T;
}

const fixture = <T>(data: T): Fixture<T> => ({ isFixture: true, data });

export const FIXTURE_PROJECT = fixture({
  publicProjectId: "TRU-PROJ-2026-0001042",
});

/** Valid format only, so it passes the schema. It is not a real transaction. */
export const FIXTURE_TX_HASH = `0x${"0".repeat(64)}`;

const FIXTURE_MILESTONE_ID = "FIXTURE_MILESTONE_0001";
const FIXTURE_OCCURRED_AT = "2026-01-01T00:00:00.000Z";
const FIXTURE_NETWORK = "FIXTURE_NETWORK";

const proofEvent = (
  eventType: ProofEventType,
  ecosystem: Ecosystem,
  referenceType: ReferenceType,
  referenceValue: string,
): Fixture<ProofEvent> =>
  fixture({
    id: `FIXTURE_EVENT_${eventType}`,
    publicProjectId: FIXTURE_PROJECT.data.publicProjectId,
    milestoneId: FIXTURE_MILESTONE_ID,
    occurredAt: FIXTURE_OCCURRED_AT,
    ecosystem,
    ...(ecosystem === "ARC"
      ? { network: "Arc Testnet", chainId: ARC_TESTNET_CHAIN_ID }
      : { network: FIXTURE_NETWORK }),
    eventType,
    referenceType,
    referenceValue,
    verificationStatus: "PENDING",
    summary: `FIXTURE: sample ${eventType} event, not real.`,
  });

/** One sample ProofEvent per event type. */
export const FIXTURE_PROOF_EVENTS: Record<ProofEventType, Fixture<ProofEvent>> = {
  AGREEMENT_ACCEPTED_CLIENT: proofEvent(
    "AGREEMENT_ACCEPTED_CLIENT",
    "APPLICATION",
    "APPLICATION_EVENT_ID",
    "0xFIXTURE_APPLICATION_EVENT_ID_CLIENT",
  ),
  AGREEMENT_ACCEPTED_FREELANCER: proofEvent(
    "AGREEMENT_ACCEPTED_FREELANCER",
    "APPLICATION",
    "APPLICATION_EVENT_ID",
    "0xFIXTURE_APPLICATION_EVENT_ID_FREELANCER",
  ),
  MILESTONE_FUNDED: proofEvent(
    "MILESTONE_FUNDED",
    "ARC",
    "BLOCKCHAIN_TRANSACTION_HASH",
    FIXTURE_TX_HASH,
  ),
  WORK_SUBMITTED: proofEvent(
    "WORK_SUBMITTED",
    "APPLICATION",
    "APPLICATION_EVENT_ID",
    "0xFIXTURE_APPLICATION_EVENT_ID_WORK",
  ),
  EVALUATION_COMPLETED: proofEvent(
    "EVALUATION_COMPLETED",
    "ZERO_G",
    "INFERENCE_REQUEST_ID",
    "0xFIXTURE_INFERENCE_REQUEST_ID",
  ),
  MILESTONE_APPROVED: proofEvent(
    "MILESTONE_APPROVED",
    "APPLICATION",
    "APPLICATION_EVENT_ID",
    "0xFIXTURE_APPLICATION_EVENT_ID_APPROVAL",
  ),
  PAYMENT_RELEASED: proofEvent(
    "PAYMENT_RELEASED",
    "ARC",
    "BLOCKCHAIN_TRANSACTION_HASH",
    FIXTURE_TX_HASH,
  ),
  AGENT_PAYMENT_SETTLED: proofEvent(
    "AGENT_PAYMENT_SETTLED",
    "HEDERA",
    "FACILITATOR_SETTLEMENT_ID",
    "0xFIXTURE_FACILITATOR_SETTLEMENT_ID",
  ),
  AGENT_PAYMENT_DENIED: proofEvent(
    "AGENT_PAYMENT_DENIED",
    "HEDERA",
    "APPLICATION_EVENT_ID",
    "0xFIXTURE_APPLICATION_EVENT_ID_DENIAL",
  ),
};
