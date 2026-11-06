import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

/** Public, non-sensitive: which integrations are configured. Contains no secrets or env values. */
export async function GET() {
  return NextResponse.json({ success: true, status: getSystemStatus() });
}
