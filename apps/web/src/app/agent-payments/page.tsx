"use client";

import { ArrowLeft, CircleSlash, Clock3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Card } from "@/components/bits";
import { useSystemStatus } from "@/hooks/useSystemStatus";

function AgentPayments() {
  const status = useSystemStatus();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-[#3867F6] hover:underline"><ArrowLeft className="h-4 w-4"/> Dashboard</Link>
      <header>
        <p className="text-sm font-medium text-[#3867F6]">Hedera Testnet · x402 v2 exact · HBAR</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Agent Payments</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Review the payment integration state and settlement safeguards. TRUSTORA does not initiate payments without an explicit, wallet-authorized user action.</p>
      </header>
      <Card>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><CircleSlash className="h-5 w-5"/></div>
          <div>
            <h2 className="font-semibold text-[#172B4D]">{status.data?.hedera.status === "CONFIGURED" ? "Configuration detected" : "Settlement unavailable"}</h2>
            <p className="mt-1 text-sm text-slate-600">{status.data?.hedera.detail ?? "Checking integration status…"}</p>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><ShieldCheck className="h-5 w-5 text-[#3867F6]"/><h2 className="mt-3 font-semibold text-[#172B4D]">Payment safeguards</h2><p className="mt-1 text-sm leading-6 text-slate-600">The planned flow requires a v2 exact payment, integer tinybars, persistent spending limits, explicit consent, facilitator settlement, and independent Mirror Node verification.</p></Card>
        <Card><Clock3 className="h-5 w-5 text-[#3867F6]"/><h2 className="mt-3 font-semibold text-[#172B4D]">Settlement history</h2><p className="mt-1 text-sm leading-6 text-slate-600">Settlement history is not connected yet. This view will show a record only after a real facilitator transaction is independently verified against Hedera Testnet.</p></Card>
      </div>
    </div>
  );
}

export default function AgentPaymentsPage() {
  return <AuthGate><AgentPayments /></AuthGate>;
}
