import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateProjectId,
  ProofTrackEngine,
} from "../src/index";

describe("Trustora ProofTrack Engine Suite", () => {
  describe("Project ID Generation", () => {
    test("formats unique project ID according to specification", () => {
      const id = generateProjectId(2026, 1042);
      assert.equal(id, "TRU-PROJ-2026-0001042");
    });
  });

  describe("Explorer URL Resolution & Taxonomy Rules", () => {
    test("generates Arc Testnet explorer URL for Arc transaction hashes", () => {
      const url = ProofTrackEngine.getExplorerUrl(
        "ARC",
        "BLOCKCHAIN_TRANSACTION_HASH",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      );
      assert.equal(
        url,
        "https://explorer.testnet.arc.io/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      );
    });

    test("generates HashScan URL for Hedera settlement IDs", () => {
      const url = ProofTrackEngine.getExplorerUrl(
        "HEDERA",
        "FACILITATOR_SETTLEMENT_ID",
        "0.0.1001@1700000000.000000000"
      );
      assert.equal(
        url,
        "https://hashscan.io/testnet/transaction/0.0.1001%401700000000.000000000"
      );
    });

    test("generates StorageScan URL for 0G storage references", () => {
      const url = ProofTrackEngine.getExplorerUrl(
        "ZERO_G",
        "STORAGE_REFERENCE",
        "0x1122334455667788"
      );
      assert.equal(
        url,
        "https://storagescan-testnet.0g.ai/file/0x1122334455667788"
      );
    });

    test("CRITICAL: 0G inference request ID MUST NOT produce an explorer URL (not a tx hash)", () => {
      const url = ProofTrackEngine.getExplorerUrl(
        "ZERO_G",
        "INFERENCE_REQUEST_ID",
        "req-0g-abc-12345"
      );
      assert.equal(url, null);
    });
  });

  describe("Event Sequencing & Timeline Aggregation", () => {
    test("maintains monotonic sequence and correlates entire lifecycle", () => {
      const engine = new ProofTrackEngine();
      const projectId = generateProjectId(2026, 1042);

      // 1. Arc Escrow Funding
      const evt1 = engine.recordEvent(projectId, {
        milestoneId: 1,
        ecosystem: "ARC",
        eventType: "ESCROW_FUNDED",
        referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
        referenceValue: "0x1111111111111111111111111111111111111111111111111111111111111111",
        verificationStatus: "VERIFIED",
      });
      assert.equal(evt1.sequence, 1);
      assert.equal(evt1.id, "TRU-PROJ-2026-0001042-EVT-0001");

      // 2. Deliverable Submission
      const evt2 = engine.recordEvent(projectId, {
        milestoneId: 1,
        ecosystem: "TRUSTORA_CORE",
        eventType: "DELIVERABLE_SUBMITTED",
        referenceType: "APPLICATION_EVENT_ID",
        referenceValue: "sub-987654",
        verificationStatus: "VERIFIED",
      });
      assert.equal(evt2.sequence, 2);

      // 3. 0G AI Evaluation
      const evt3 = engine.recordEvent(projectId, {
        milestoneId: 1,
        ecosystem: "ZERO_G",
        eventType: "0G_EVALUATION_COMPLETED",
        referenceType: "INFERENCE_REQUEST_ID",
        referenceValue: "0g-req-556677",
        verificationStatus: "PENDING",
      });
      assert.equal(evt3.sequence, 3);
      assert.equal(evt3.explorerUrl, null); // No explorer URL for inference IDs

      // 4. Hedera Agent Micropayment
      const evt4 = engine.recordEvent(projectId, {
        milestoneId: 1,
        ecosystem: "HEDERA",
        eventType: "HEDERA_AGENT_SETTLED",
        referenceType: "FACILITATOR_SETTLEMENT_ID",
        referenceValue: "0.0.1001@1700000000.000000000",
        verificationStatus: "VERIFIED",
      });
      assert.equal(evt4.sequence, 4);

      // 5. Arc Escrow Release
      const evt5 = engine.recordEvent(projectId, {
        milestoneId: 1,
        ecosystem: "ARC",
        eventType: "ESCROW_RELEASED",
        referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
        referenceValue: "0x2222222222222222222222222222222222222222222222222222222222222222",
        verificationStatus: "VERIFIED",
      });
      assert.equal(evt5.sequence, 5);

      // Retrieve full timeline
      const timeline = engine.getTimeline(projectId, 1);
      assert.equal(timeline.events.length, 5);
      assert.equal(timeline.isFullySettled, true);
      assert.equal(timeline.completionRatio, 1.0);
    });
  });
});

