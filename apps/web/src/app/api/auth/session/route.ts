import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Reports the authenticated wallet for this browser, if any. */
export async function GET(req: Request) {
  const session = await getSession(req);
  return NextResponse.json({ success: true, authenticated: !!session, address: session?.address ?? null });
}
