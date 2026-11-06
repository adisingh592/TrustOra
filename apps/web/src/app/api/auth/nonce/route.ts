import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { consumeRateLimit, issueNonce } from "@/lib/session";
import { isAccountRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Issues a single-use, 10-minute login nonce. */
export async function POST(req: Request) {
  try {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const key = `nonce:${forwarded || "unknown"}`;
    await consumeRateLimit(key, 10, 60_000);
    const body = await req.json().catch(() => ({}));
    if (!isAddress(body?.address, { strict: false }) || !isAccountRole(body?.role)) {
      return NextResponse.json({ success: false, error: "A wallet address and registration role (CLIENT or FREELANCER) are required" }, { status: 400 });
    }
    const { nonce, expiresAt } = await issueNonce(body.address, body.role);
    return NextResponse.json({ success: true, nonce, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 429) {
      return NextResponse.json({ success: false, error: error.message }, { status: 429 });
    }
    console.error("nonce error", error);
    return NextResponse.json({ success: false, error: "Could not issue nonce" }, { status: 500 });
  }
}
