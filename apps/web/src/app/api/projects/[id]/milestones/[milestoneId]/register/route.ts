import { handleRegisterMilestone } from "@/lib/escrow-db";

/**
 * Records the client's addMilestone transaction (signed in their wallet) after verifying it on Arc.
 * Body: { txHash }. Milestones must be registered in index order.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; milestoneId: string } }
) {
  return handleRegisterMilestone(req, params);
}
