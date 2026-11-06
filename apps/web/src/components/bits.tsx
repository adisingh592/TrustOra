import { ExternalLink } from "lucide-react";
import { STATE_LABEL, STATE_TONE, arcTxUrl, shortHash } from "@/lib/format";

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATE_TONE[state] ?? STATE_TONE.UNFUNDED}`}>
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

/** A transaction hash that links to the Arc explorer. */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={arcTxUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-[#3867F6] hover:underline" title={hash}>
      {label ? `${label}: ` : ""}
      {shortHash(hash)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass-card rounded-xl p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="glass-card rounded-xl p-8 text-center">
      <p className="font-medium text-[#172B4D]">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} aria-hidden />;
}

/** Loading placeholder shaped like the content it replaces, so the page does not jump. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
    </div>
  );
}

/** Error state with a retry, so a failed request is recoverable without reloading the page. */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="glass-card rounded-xl p-8 text-center">
      <p className="font-medium text-[#172B4D]">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      {onRetry && <button onClick={onRetry} className="mt-4 rounded-lg border border-[#E5EAF1] px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Try again</button>}
    </div>
  );
}
