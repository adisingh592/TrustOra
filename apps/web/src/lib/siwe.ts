/**
 * Sign-In with Ethereum (EIP-4361 style) message building, parsing and signature verification.
 * Pure: no database, no network. The signature is checked locally by ECDSA recovery, so a session
 * proves the browser controls the wallet key without ever exposing it.
 */
import { getAddress, recoverMessageAddress, isAddress } from "viem";

export const SIWE_STATEMENT =
  "Sign in to TRUSTORA. This signature proves wallet ownership only. It does not authorize any transaction or movement of funds.";

export const NONCE_TTL_MS = 10 * 60 * 1000;
export const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
export const CLOCK_SKEW_MS = 60 * 1000;

export interface LoginMessageFields {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export function buildLoginMessage(f: LoginMessageFields): string {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    getAddress(f.address),
    "",
    SIWE_STATEMENT,
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

export class AuthMessageError extends Error {
  constructor(readonly code:
    | "MALFORMED_MESSAGE"
    | "DOMAIN_MISMATCH"
    | "CHAIN_MISMATCH"
    | "MESSAGE_EXPIRED"
    | "MESSAGE_NOT_YET_VALID"
    | "BAD_SIGNATURE"
    | "ADDRESS_MISMATCH", message: string) {
    super(message);
    this.name = "AuthMessageError";
  }
}

/** Strict parser: the message must be exactly what buildLoginMessage produces. */
export function parseLoginMessage(message: string): LoginMessageFields {
  const malformed = () => new AuthMessageError("MALFORMED_MESSAGE", "Login message is malformed");
  if (typeof message !== "string" || message.length > 1000) throw malformed();
  const lines = message.split("\n");
  if (lines.length !== 11) throw malformed();
  const header = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0]!);
  if (!header) throw malformed();
  const address = lines[1]!;
  if (!isAddress(address, { strict: false })) throw malformed();
  if (lines[2] !== "" || lines[3] !== SIWE_STATEMENT || lines[4] !== "") throw malformed();
  const field = (line: string | undefined, key: string): string => {
    const prefix = `${key}: `;
    if (!line || !line.startsWith(prefix)) throw malformed();
    return line.slice(prefix.length);
  };
  const uri = field(lines[5], "URI");
  if (field(lines[6], "Version") !== "1") throw malformed();
  const chainId = Number(field(lines[7], "Chain ID"));
  const nonce = field(lines[8], "Nonce");
  const issuedAt = field(lines[9], "Issued At");
  const expirationTime = field(lines[10], "Expiration Time");
  if (!Number.isInteger(chainId) || !/^[0-9a-f]{32}$/.test(nonce)) throw malformed();
  if (Number.isNaN(Date.parse(issuedAt)) || Number.isNaN(Date.parse(expirationTime))) throw malformed();
  return { domain: header[1]!, address: getAddress(address), uri, chainId, nonce, issuedAt, expirationTime };
}

export interface VerifyLoginParams {
  message: string;
  signature: string;
  expectedDomain: string;
  expectedChainId: number;
  now?: Date;
}

/**
 * Verifies a signed login message. Returns the signing wallet (checksummed) and the nonce to consume.
 * Throws AuthMessageError for any problem; callers must still consume the nonce atomically.
 */
export async function verifyLoginSignature(p: VerifyLoginParams): Promise<{ address: string; nonce: string; fields: LoginMessageFields }> {
  const fields = parseLoginMessage(p.message);
  const now = (p.now ?? new Date()).getTime();

  if (fields.domain !== p.expectedDomain) {
    throw new AuthMessageError("DOMAIN_MISMATCH", "Login message was issued for a different domain");
  }
  if (fields.chainId !== p.expectedChainId) {
    throw new AuthMessageError("CHAIN_MISMATCH", "Login message is for a different chain");
  }
  const issued = Date.parse(fields.issuedAt);
  const expires = Date.parse(fields.expirationTime);
  if (issued > now + CLOCK_SKEW_MS) throw new AuthMessageError("MESSAGE_NOT_YET_VALID", "Login message is dated in the future");
  if (now > expires || now - issued > MESSAGE_MAX_AGE_MS) throw new AuthMessageError("MESSAGE_EXPIRED", "Login message has expired");

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: p.message, signature: p.signature as `0x${string}` });
  } catch {
    throw new AuthMessageError("BAD_SIGNATURE", "Signature is invalid");
  }
  if (getAddress(recovered) !== fields.address) {
    throw new AuthMessageError("ADDRESS_MISMATCH", "Signature was not made by the wallet named in the message");
  }
  return { address: fields.address, nonce: fields.nonce, fields };
}

// ---- Agreement acceptance message (signed by the freelancer; verified server-side) ----

export function buildAgreementMessage(p: { projectId: string; versionNumber: number; criteriaHash: string; role: "CLIENT" | "FREELANCER" }): string {
  return [
    "TRUSTORA agreement acceptance",
    `Project: ${p.projectId}`,
    `Agreement version: ${p.versionNumber}`,
    `Criteria hash: ${p.criteriaHash.replace(/^0x/, "").toLowerCase()}`,
    `Role: ${p.role}`,
    "Signing accepts these acceptance criteria. It does not authorize any transaction or movement of funds.",
  ].join("\n");
}

export async function verifyAgreementSignature(p: {
  message: string;
  signature: string;
  expectedAddress: string;
}): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message: p.message, signature: p.signature as `0x${string}` });
    return getAddress(recovered) === getAddress(p.expectedAddress);
  } catch {
    return false;
  }
}
