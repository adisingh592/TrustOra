import {
  HederaAgentPayer,
  X402Challenge,
  AgentPaymentResult,
} from "../../../../packages/hedera/src/index";
import { reserveHederaSpend } from "./hedera-ledger";

export async function triggerHederaAgentPayment(
  resourceId: string,
  serviceType: "SECURITY_SCAN" | "CODE_QUALITY" = "SECURITY_SCAN"
): Promise<AgentPaymentResult> {
  const payer = new HederaAgentPayer({ spendLedger: { reserve: reserveHederaSpend } });

  const challenge: X402Challenge = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    recipient: "0.0.482910", // Registered code auditor testnet account
    amountHbar: serviceType === "SECURITY_SCAN" ? 1.5 : 0.75,
    resourceId,
  };

  const providerHost = "audit.trustora.network";
  return await payer.executeAutonomousPayment(challenge, providerHost);
}
