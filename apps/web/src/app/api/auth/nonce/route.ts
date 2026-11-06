import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Issues a single-use, 10-minute login nonce. */
export async function POST() {
  try {
    const { nonce, expiresAt } = await issueNonce();
    return NextResponse.json({ success: true, nonce, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error("nonce error", error);
    return NextResponse.json({ success: false, error: "Could not issue nonce" }, { status: 500 });
  }
}
