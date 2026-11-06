/**
 * Server-side wallet sessions. The cookie holds a random 256-bit token; only its SHA-256 is stored,
 * so a database leak cannot be replayed as a session, and no signing secret is needed.
 * Helpers read cookies from the standard Request, so route handlers stay testable without Next internals.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { NONCE_TTL_MS } from "./siwe";
import type { AccountRole } from "./roles";

export const SESSION_COOKIE = "trustora_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(readonly status: 401 | 403 | 409 | 429, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<void> {
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error("Invalid rate limit configuration");
  }
  const started = BigInt(now - (now % windowMs));
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("key", "windowStarted", "requestCount", "updatedAt")
    VALUES (${key}, ${started}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT("key") DO UPDATE SET
        "requestCount" = CASE
          WHEN "RateLimitBucket"."windowStarted" <> ${started} THEN 1
          ELSE "RateLimitBucket"."requestCount" + 1
        END,
        "windowStarted" = CASE
          WHEN "RateLimitBucket"."windowStarted" <> ${started} THEN ${started}
          ELSE "RateLimitBucket"."windowStarted"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
  `;
  const row = await prisma.rateLimitBucket.findUnique({ where: { key }, select: { requestCount: true } });
  if (!row || row.requestCount > limit) throw new AuthError(429, "Too many requests; try again later");
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function requestDomain(req: Request): string {
  return new URL(req.url).host;
}

function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export async function issueNonce(address: string, role: AccountRole, now = new Date()): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await prisma.authNonce.create({ data: { nonce, address: address.toLowerCase(), role, expiresAt } });
  // Opportunistic cleanup keeps the table small.
  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } } });
  return { nonce, expiresAt };
}

/** Atomically consumes a nonce. Returns false if it is unknown, expired or already used. */
export async function consumeNonce(nonce: string, address: string, role: AccountRole, now = new Date()): Promise<boolean> {
  const r = await prisma.authNonce.updateMany({
    where: { nonce, address: address.toLowerCase(), role, usedAt: null, expiresAt: { gt: now } },
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

export async function requireAccountRole(address: string, role: AccountRole): Promise<void> {
  const user = await prisma.user.findUnique({ where: { walletAddress: address.toLowerCase() }, select: { role: true } });
  if (!user) throw new AuthError(403, "Wallet registration is required before using this workspace");
  if (user.role !== role) throw new AuthError(403, `This wallet is registered as ${user.role}; it cannot act as ${role}`);
}

/**
 * Creates the one-role account and its session in one transaction. Historical project ownership
 * is checked before first registration so migration never silently changes an existing wallet's role.
 */
export async function registerAccountAndCreateSession(address: string, role: AccountRole, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const normalized = address.toLowerCase();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { walletAddress: normalized }, select: { role: true } });
      if (existing) {
        if (existing.role !== role) throw new AuthError(403, `This wallet is registered as ${existing.role}; it cannot register as ${role}`);
      } else {
        const [asClient, asFreelancer] = await Promise.all([
          tx.project.count({ where: { clientAddress: normalized } }),
          tx.project.count({ where: { freelancerAddress: normalized } }),
        ]);
        if ((role === "CLIENT" && asFreelancer > 0) || (role === "FREELANCER" && asClient > 0)) {
          throw new AuthError(409, "This wallet already owns projects under the opposite role; refusing to reassign it");
        }
        await tx.user.create({ data: { walletAddress: normalized, role } });
      }
      await tx.session.create({ data: { id: sha256(token), address: normalized, expiresAt } });
      return { token, expiresAt };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      throw new AuthError(409, "This wallet was registered concurrently; sign in again with its registered role");
    }
    throw error;
  }
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
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    await consumeRateLimit(`mutation:${session.address}`, 60, 60_000);
  }
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
