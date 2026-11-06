/**
 * Server-side wallet sessions. The cookie holds a random 256-bit token; only its SHA-256 is stored,
 * so a database leak cannot be replayed as a session, and no signing secret is needed.
 * Helpers read cookies from the standard Request, so route handlers stay testable without Next internals.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { NONCE_TTL_MS } from "./siwe";

export const SESSION_COOKIE = "trustora_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function requestDomain(req: Request): string {
  return new URL(req.url).host;
}

function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export async function issueNonce(now = new Date()): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await prisma.authNonce.create({ data: { nonce, expiresAt } });
  // Opportunistic cleanup keeps the table small.
  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } } });
  return { nonce, expiresAt };
}

/** Atomically consumes a nonce. Returns false if it is unknown, expired or already used. */
export async function consumeNonce(nonce: string, now = new Date()): Promise<boolean> {
  const r = await prisma.authNonce.updateMany({
    where: { nonce, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return r.count === 1;
}

export async function createSession(address: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: sha256(token), address: address.toLowerCase(), expiresAt } });
  return { token, expiresAt };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The authenticated wallet (lowercase) for this request, or null. */
export async function getSession(req: Request, now = new Date()): Promise<{ address: string } | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const row = await prisma.session.findUnique({ where: { id } });
  if (!row) return null;
  if (row.expiresAt <= now) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  return { address: row.address };
}

/** Throws AuthError unless the request carries a valid session; also blocks cross-origin mutations. */
export async function requireSession(req: Request): Promise<{ address: string }> {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== requestDomain(req)) throw new AuthError(403, "Cross-origin request blocked");
    }
  }
  const session = await getSession(req);
  if (!session) throw new AuthError(401, "Authentication required: sign in with your wallet");
  return session;
}

export async function destroySession(req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
}

export function setSessionCookie(res: NextResponse, req: Request, token: string, expiresAt: Date): void {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    ...(isSecureRequest(req) ? ["Secure"] : []),
  ];
  res.headers.append("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.headers.append(
    "Set-Cookie",
    [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", ...(isSecureRequest(req) ? ["Secure"] : [])].join("; "),
  );
}

export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  return null;
}
