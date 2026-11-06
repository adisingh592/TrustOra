import {
  ARC_TESTNET_CHAIN_ID,
  type EscrowAdapter,
  type EscrowState,
  type VerifiedChainEvent,
} from "@trustora/shared";
import { NO_VERIFIER_REASON } from "./core.js";
import type { StoredEvent, Verifier, VerifierResult } from "./types.js";

const sameHex = (a: unknown, b: unknown) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");

const sameAddress = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Compares what the chain reports with what our database expects.
 *
 * The adapter contract this relies on: verifyFunding and verifyRelease must THROW
 * when the answer is not known yet (RPC down, transaction not mined), and return
 * verified: false only for a transaction that really failed. A throw leaves the
 * event PENDING. A false marks it FAILED.
 *
 * Reasons never repeat the compared values. Read-only: adapter methods that check
 * a transaction are the only ones this calls, so it can never move money.
 */
export const createChainVerifier = (adapter: EscrowAdapter): Verifier => {
  const checkTransaction = (event: StoredEvent) => {
    if (event.eventType === "MILESTONE_FUNDED") return adapter.verifyFunding.bind(adapter);
    if (event.eventType === "PAYMENT_RELEASED") return adapter.verifyRelease.bind(adapter);
    return null;
  };

  return async (event) => {
    const result = (outcome: VerifierResult["outcome"], reason?: string): VerifierResult => ({
      outcome,
      ...(reason ? { reason } : {}),
      checkedAt: new Date(),
    });

    // The interface has no method for this step: refuse rather than guess.
    const check = checkTransaction(event);
    if (!check) return result("UNAVAILABLE", NO_VERIFIER_REASON);

    // Never MATCH against nothing: every core field must be there to compare.
    const { onchainMilestoneId, amountBaseUnits, tokenAddress, freelancerWallet, agreementHash } =
      event.expected;
    if (!onchainMilestoneId || !amountBaseUnits || !tokenAddress || !freelancerWallet || !agreementHash) {
      return result("UNAVAILABLE", "The details needed for this check are incomplete.");
    }

    const config = adapter.getConfig();
    const chain: VerifiedChainEvent = await check(onchainMilestoneId, event.referenceValue);

    if (chain.verified !== true) return result("MISMATCH", "The transaction did not succeed.");
    if (!sameHex(chain.txHash, event.referenceValue)) {
      return result("MISMATCH", "The transaction hash does not match.");
    }
    if (chain.chainId !== ARC_TESTNET_CHAIN_ID || config.chainId !== ARC_TESTNET_CHAIN_ID) {
      return result("MISMATCH", "The transaction is on the wrong chain.");
    }
    if (!sameAddress(chain.contractAddress, config.escrowAddress)) {
      return result("MISMATCH", "The transaction did not target our escrow contract.");
    }
    if (!sameHex(chain.milestoneId, onchainMilestoneId)) {
      return result("MISMATCH", "The milestone does not match.");
    }
    if (chain.amount !== amountBaseUnits) return result("MISMATCH", "The amount does not match.");
    if (!sameAddress(chain.token, tokenAddress) || !sameAddress(chain.token, config.tokenAddress)) {
      return result("MISMATCH", "The token does not match.");
    }
    if (!sameAddress(chain.freelancer, freelancerWallet)) {
      return result("MISMATCH", "The freelancer does not match.");
    }
    if (!sameHex(chain.agreementHash, agreementHash)) {
      return result("MISMATCH", "The agreement hash does not match.");
    }

    // VerifiedChainEvent has no client, arbiter or deliverable, so these come from
    // the escrow's current state, and only when our database expects them.
    const { clientWallet, arbiterWallet, deliverableSha256 } = event.expected;
    if (clientWallet || arbiterWallet || deliverableSha256) {
      const escrow: EscrowState = await adapter.readEscrow(onchainMilestoneId);
      if (clientWallet && !sameAddress(escrow.client, clientWallet)) {
        return result("MISMATCH", "The client does not match.");
      }
      if (arbiterWallet && !sameAddress(escrow.arbiter, arbiterWallet)) {
        return result("MISMATCH", "The arbiter does not match.");
      }
      if (deliverableSha256 && !sameHex(escrow.deliverableHash, deliverableSha256)) {
        return result("MISMATCH", "The deliverable hash does not match.");
      }
    }

    return result("MATCH");
  };
};
