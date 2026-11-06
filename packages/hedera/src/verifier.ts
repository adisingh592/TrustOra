/**
 * @file verifier.ts
 * @description Independent settlement verification against the Hedera Mirror Node.
 *
 * A facilitator's "success" is a claim. A payment is VERIFIED only when the public Mirror Node shows the
 * transaction with result SUCCESS and the exact transfer we agreed to: the payer debited `amount` tinybars
 * and the recipient credited `amount` tinybars. Anything less is reported as what it is.
 */
import { isHederaAccountId } from "./units";

export const TESTNET_MIRROR_URL = "https://testnet.mirrornode.hedera.com/api/v1";

export type SettlementCheck =
  | { status: "VERIFIED"; consensusTimestamp: string; mirrorTransactionId: string }
  | { status: "NOT_FOUND_YET"; reason: string } // retryable: the Mirror Node can lag consensus by a few seconds
  | { status: "UNREACHABLE"; reason: string } // retryable: network error, 5xx, rate limit
  | { status: "FAILED_ON_CHAIN"; reason: string } // the transaction reached consensus but did not succeed
  | { status: "MISMATCH"; reason: string } // it succeeded, but it is not the payment we agreed to
  | { status: "INVALID_TX_ID"; reason: string };

export interface ExpectedSettlement {
  /** Transaction ID as returned by the facilitator: accountId@seconds.nanos */
  txId: string;
  payer: string;
  payTo: string;
  amountTinybars: bigint;
}

const TX_ID = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/;
const MIRROR_TX_ID = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/;

/**
 * "0.0.1235@1700000000.000000000" -> "0.0.1235-1700000000-000000000" (Mirror Node path form).
 * Returns null for anything that is not a well-formed Hedera transaction ID.
 */
export function toMirrorTransactionId(txId: string): string | null {
  if (typeof txId !== "string") return null;
  const m = TX_ID.exec(txId.trim()) ?? MIRROR_TX_ID.exec(txId.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export const hashScanTransactionUrl = (txId: string) =>
  `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}`;

function netTransfer(transfers: Array<{ account?: unknown; amount?: unknown }>, account: string): bigint | null {
  let sum = 0n;
  for (const t of transfers) {
    if (t.account !== account) continue;
    if (typeof t.amount !== "number" || !Number.isSafeInteger(t.amount)) return null;
    sum += BigInt(t.amount);
  }
  return sum;
}

export class HederaSettlementVerifier {
  private readonly mirrorUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { mirrorUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.mirrorUrl = (opts.mirrorUrl ?? TESTNET_MIRROR_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  getHashScanUrl(txId: string): string {
    return hashScanTransactionUrl(txId);
  }

  async verifySettlement(txId: string, payTo: string, amountHbar: number): Promise<{
    isVerified: boolean;
    consensusTimestamp?: string;
    statusString?: string;
    error?: string;
  }> {
    if (!txId) return { isVerified: false, error: "MISSING_TX_ID" };
    if (!Number.isFinite(amountHbar) || amountHbar <= 0) {
      return { isVerified: false, error: "INVALID_AMOUNT" };
    }
    const result = await this.check({
      txId,
      payer: "0.0.0",
      payTo,
      amountTinybars: BigInt(Math.round(amountHbar * 100_000_000)),
    });
    if (result.status === "VERIFIED") {
      return { isVerified: true, consensusTimestamp: result.consensusTimestamp, statusString: "SUCCESS" };
    }
    return { isVerified: false, statusString: result.status, error: result.reason };
  }

  /** One Mirror Node lookup. Never throws. */
  async check(expected: ExpectedSettlement): Promise<SettlementCheck> {
    const mirrorId = toMirrorTransactionId(expected.txId);
    if (!mirrorId) return { status: "INVALID_TX_ID", reason: "Not a Hedera transaction ID (expected accountId@seconds.nanos)" };
    if (!isHederaAccountId(expected.payer) || !isHederaAccountId(expected.payTo)) {
      return { status: "MISMATCH", reason: "Payer and recipient must be Hedera account IDs" };
    }
    if (expected.amountTinybars <= 0n) return { status: "MISMATCH", reason: "Expected amount must be positive" };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.mirrorUrl}/transactions/${mirrorId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      return { status: "UNREACHABLE", reason: `Mirror Node request failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.status === 404) return { status: "NOT_FOUND_YET", reason: "The Mirror Node does not have this transaction yet" };
    if (!res.ok) return { status: "UNREACHABLE", reason: `Mirror Node returned HTTP ${res.status}` };

    let body: any;
    try {
      body = await res.json();
    } catch {
      return { status: "UNREACHABLE", reason: "Mirror Node returned invalid JSON" };
    }
    const all: any[] = Array.isArray(body?.transactions) ? body.transactions : [];
    if (all.length === 0) return { status: "NOT_FOUND_YET", reason: "The Mirror Node returned no records for this transaction" };
    // The parent transaction has nonce 0; child records (if any) have higher nonces.
    const tx = all.find((t) => t?.nonce === 0 || t?.nonce === undefined) ?? all[0];

    if (tx.transaction_id !== undefined && tx.transaction_id !== mirrorId) {
      return { status: "MISMATCH", reason: "The Mirror Node record is for a different transaction ID" };
    }
    if (tx.result !== "SUCCESS") {
      return { status: "FAILED_ON_CHAIN", reason: `The transaction reached consensus with result ${String(tx.result)}` };
    }
    if (tx.name !== "CRYPTOTRANSFER") {
      return { status: "MISMATCH", reason: `Expected a CRYPTOTRANSFER, found ${String(tx.name)}` };
    }
    const transfers = Array.isArray(tx.transfers) ? tx.transfers : [];
    const credited = netTransfer(transfers, expected.payTo);
    const debited = netTransfer(transfers, expected.payer);
    if (credited === null || debited === null) return { status: "MISMATCH", reason: "Transfer amounts are not safe integers" };
    if (credited !== expected.amountTinybars) {
      return { status: "MISMATCH", reason: `Recipient ${expected.payTo} was credited ${credited} tinybars, expected ${expected.amountTinybars}` };
    }
    // The facilitator pays network fees, so the payer's net movement is exactly the payment.
    if (debited !== -expected.amountTinybars) {
      return { status: "MISMATCH", reason: `Payer ${expected.payer} moved ${debited} tinybars, expected -${expected.amountTinybars}` };
    }
    const consensusTimestamp = typeof tx.consensus_timestamp === "string" ? tx.consensus_timestamp : "";
    if (!consensusTimestamp) return { status: "MISMATCH", reason: "The Mirror Node record has no consensus timestamp" };
    return { status: "VERIFIED", consensusTimestamp, mirrorTransactionId: mirrorId };
  }

  /**
   * Polls while the result is retryable (NOT_FOUND_YET / UNREACHABLE). Stops at the first definitive answer.
   * Default: 6 attempts, 2.5 s apart (about 15 s), which covers normal Mirror Node lag.
   */
  async waitForSettlement(
    expected: ExpectedSettlement,
    opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<SettlementCheck> {
    const attempts = Math.max(1, opts.attempts ?? 6);
    const delayMs = opts.delayMs ?? 2500;
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let last: SettlementCheck = { status: "NOT_FOUND_YET", reason: "not checked" };
    for (let i = 0; i < attempts; i++) {
      last = await this.check(expected);
      if (last.status !== "NOT_FOUND_YET" && last.status !== "UNREACHABLE") return last;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return last;
  }
}
