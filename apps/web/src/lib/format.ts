import { ARC_TESTNET_CONFIG } from "./arc";

export const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

export const formatUsdc = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const arcTxUrl = (hash: string) => `${ARC_TESTNET_CONFIG.blockExplorers.default.url}/tx/${hash}`;
export const arcAddressUrl = (addr: string) => `${ARC_TESTNET_CONFIG.blockExplorers.default.url}/address/${addr}`;

export const STATE_LABEL: Record<string, string> = {
  UNFUNDED: "Awaiting funding",
  FUNDED: "Funded in escrow",
  SUBMITTED: "Work submitted",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved",
  RELEASED: "Released to freelancer",
  DISPUTED: "In dispute",
  REFUNDED: "Refunded to client",
};

export const STATE_TONE: Record<string, string> = {
  UNFUNDED: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  FUNDED: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  SUBMITTED: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  REVISION_REQUESTED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  APPROVED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  RELEASED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  DISPUTED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  REFUNDED: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

/** Same-origin error text for display: never dumps raw objects. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const any = e as { shortMessage?: string; message?: string };
    return (any.shortMessage ?? any.message ?? "Something went wrong").split("\n")[0]!.slice(0, 300);
  }
  return typeof e === "string" ? e : "Something went wrong";
}
