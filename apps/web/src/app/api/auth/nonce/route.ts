import { NextResponse } from "next/server";
import { consumeRateLimit, issueNonce } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Issues a single-use, 10-minute login nonce. */
export async function POST(req: Request) {
  try {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const key = `nonce:${forwarded || "unknown"}`;
    await consumeRateLimit(key, 10, 60_000);
    const { nonce, expiresAt } = await issueNonce();
    return NextResponse.json({ success: true, nonce, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 429) {
      return NextResponse.json({ success: false, error: error.message }, { status: 429 });
    }
    console.error("nonce error", error);
    return NextResponse.json({ success: false, error: "Could not issue nonce" }, { status: 500 });
  }
}
