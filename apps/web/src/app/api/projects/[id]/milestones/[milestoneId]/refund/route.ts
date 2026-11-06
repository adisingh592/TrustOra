import { handleEscrowTxRequest } from "@/lib/escrow-db";

/**
 * Records a refund transaction that the user's wallet already sent to the Arc escrow contract.
 * Body: { txHash }. Nothing is recorded unless the receipt, event logs, sender role and
 * on-chain milestone state all verify. The backend never signs or sends transactions.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  return handleEscrowTxRequest(req, await params, "refund");
}
