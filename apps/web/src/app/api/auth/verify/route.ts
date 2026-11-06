import { NextResponse } from "next/server";
import { ARC_TESTNET_CONFIG } from "@/lib/arc";
import { AuthMessageError, verifyLoginSignature } from "@/lib/siwe";
import { authErrorResponse, consumeNonce, consumeRateLimit, registerAccountAndCreateSession, requestDomain, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Verifies a signed login message (domain, chain, freshness, ECDSA signer == address in message),
 * consumes its single-use nonce, and starts a session bound to that wallet.
 * Body: { message, signature }.
 */
export async function POST(req: Request) {
  try {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    await consumeRateLimit(`verify:${forwarded || "unknown"}`, 20, 60_000);
    const body = await req.json().catch(() => ({}));
    const { message, signature } = body ?? {};
    if (typeof message !== "string" || typeof signature !== "string") {
      return NextResponse.json({ success: false, error: "message and signature are required" }, { status: 400 });
    }

    const { address, nonce, fields } = await verifyLoginSignature({
      message,
      signature,
      expectedDomain: requestDomain(req),
      expectedChainId: ARC_TESTNET_CONFIG.id,
    });

    if (!(await consumeNonce(nonce, address, fields.role))) {
      return NextResponse.json({ success: false, error: "Nonce is invalid, expired or already used" }, { status: 401 });
    }

    const { token, expiresAt } = await registerAccountAndCreateSession(address, fields.role);
    const res = NextResponse.json({ success: true, address, expiresAt: expiresAt.toISOString() });
    setSessionCookie(res, req, token, expiresAt);
    return res;
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 429) {
      return NextResponse.json({ success: false, error: error.message }, { status: 429 });
    }
    if (error instanceof AuthMessageError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 401 });
    }
    console.error("verify error", error);
    return NextResponse.json({ success: false, error: "Authentication failed" }, { status: 500 });
  }
}
