import { handleRegisterProject } from "@/lib/escrow-db";

/**
 * Records the client's createProject transaction (signed in their wallet) after verifying it on Arc.
 * Body: { txHash }. A database project is not considered on-chain until this succeeds.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRegisterProject(req, await params);
}
