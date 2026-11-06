import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Reports the authenticated wallet for this browser, if any. */
export async function GET(req: Request) {
  const session = await getSession(req);
  const user = session ? await prisma.user.findUnique({ where: { walletAddress: session.address }, select: { role: true } }) : null;
  return NextResponse.json({ success: true, authenticated: !!session && !!user, address: session?.address ?? null, role: user?.role ?? null });
}
