import { NextResponse } from "next/server";
import { AuthError, clearSessionCookie, destroySession, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch (error) {
    if (!(error instanceof AuthError) || error.status === 403) {
      return NextResponse.json({ success: false, error: "Blocked" }, { status: 403 });
    }
    // Not signed in: still clear any stale cookie.
  }
  await destroySession(req);
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res, req);
  return res;
}
