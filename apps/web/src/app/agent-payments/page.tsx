"use client";

import { ArrowLeft, CheckCircle2, CircleSlash, Clock3, ExternalLink, FileCheck, Layers, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Card } from "@/components/bits";
import { useSystemStatus } from "@/hooks/useSystemStatus";

const JUDGE_EXPLANATION =
  "Hedera was considered as an additional blockchain infrastructure layer for recording important project events and improving auditability. However, TRUSTORA's primary evidence-anchoring architecture uses Arkiv, while Arc handles optional payment settlement.";

const TECH_ROLES = [
  { technology: "Hedera", role: "Optional blockchain-based project records and auditability" },
  { technology: "Arc", role: "USDC escrow and payment settlement" },
  { technology: "0G", role: "AI inference and computation" },
  { technology: "Arkiv", role: "Public, hash-only evidence anchoring" },
  { technology: "ProofTrack", role: "Evidence verification and project audit timeline" },
] as const;

function AgentPayments() {
  const status = useSystemStatus();
  const isConfigured = status.data?.hedera.status === "CONFIGURED";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-[#3867F6] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <header>
        <p className="text-sm font-medium text-[#3867F6]">Hedera Testnet · HCS Audit Records · x402 v2 exact · HBAR</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Hedera Integration & Auditability</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          In TRUSTORA, Hedera is an optional blockchain infrastructure layer designed for recording critical project activities and providing enterprise auditability alongside autonomous agent payment safeguards.
        </p>
      </header>

      {/* Integration Status Banner */}
      <Card>
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${isConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {isConfigured ? <CheckCircle2 className="h-5 w-5" /> : <CircleSlash className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#172B4D]">
                {isConfigured ? "Hedera Testnet Active" : "Hedera Audit Layer: Optional / Unconfigured"}
              </h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${isConfigured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {isConfigured ? "Configured" : "Optional"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{status.data?.hedera.detail ?? "Checking integration status…"}</p>
          </div>
        </div>
      </Card>

      {/* Technology Architecture Matrix */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-5 w-5 text-[#3867F6]" />
          <h2 className="font-semibold text-[#172B4D]">Multi-Chain Architecture: How Hedera Fits</h2>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          TRUSTORA leverages specialized technologies for each stage of the escrow lifecycle:
        </p>
        <div className="overflow-x-auto rounded-lg border border-[#E5EAF1]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F8FAFC] text-slate-700 font-semibold border-b border-[#E5EAF1]">
              <tr>
                <th className="px-4 py-3">Technology</th>
                <th className="px-4 py-3">Role in TRUSTORA</th>
                <th className="px-4 py-3">Verification Mechanism</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5EAF1] text-slate-600">
              {TECH_ROLES.map((t) => (
                <tr key={t.technology} className={t.technology === "Hedera" ? "bg-purple-50/50 font-medium text-purple-900" : ""}>
                  <td className="px-4 py-3 font-semibold text-[#172B4D]">{t.technology}</td>
                  <td className="px-4 py-3">{t.role}</td>
                  <td className="px-4 py-3 text-xs">
                    {t.technology === "Hedera" && "Hedera Mirror Node & HashScan"}
                    {t.technology === "Arc" && "Arc Testnet Contract Event Logs"}
                    {t.technology === "0G" && "0G Compute Router Inference IDs"}
                    {t.technology === "Arkiv" && "Public Immutable Root Hashes"}
                    {t.technology === "ProofTrack" && "Cross-chain Timeline Chaining"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Judge Explanation & Evaluation Guidance */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Scale className="h-5 w-5 text-[#3867F6]" />
          <h2 className="font-semibold text-[#172B4D]">How to Explain Hedera to Judges</h2>
        </div>
        <blockquote className="rounded-lg border-l-4 border-[#3867F6] bg-blue-50/60 p-4 text-sm italic text-slate-800">
          &ldquo;{JUDGE_EXPLANATION}&rdquo;
        </blockquote>
        <p className="mt-3 text-xs text-slate-500">
          <strong>Honesty Invariant:</strong> TRUSTORA presents Hedera strictly for its verified capabilities. The primary escrow operates on Arc Testnet, advisory evaluations use 0G, and public evidence anchoring uses Arkiv.
        </p>
      </Card>

      {/* 4 Project Activity Record Roles */}
      <div>
        <h2 className="text-lg font-semibold text-[#172B4D] mb-3">Blockchain-Based Project Records</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2 text-[#3867F6]">
              <FileCheck className="h-5 w-5" />
              <h3 className="font-semibold text-[#172B4D]">1. Agreement Acceptance</h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Consensus-timestamped proof of frozen criteria hashes and dual SIWE wallet acceptance (Client & Freelancer) to prevent scope alteration.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2 text-[#3867F6]">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="font-semibold text-[#172B4D]">2. Milestone Completion</h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Immutable recording of deliverable SHA-256 hashes and on-chain release authorizations when milestone escrow payouts are fulfilled.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2 text-[#3867F6]">
              <ShieldCheck className="h-5 w-5" />
              <h3 className="font-semibold text-[#172B4D]">3. Activity Verification</h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Anchors 0G AI advisory evaluation outcomes, TEE attestation claims, and consensus states as verifiable ProofTrack audit references.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2 text-[#3867F6]">
              <ExternalLink className="h-5 w-5" />
              <h3 className="font-semibold text-[#172B4D]">4. HashScan References</h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Generates independent HashScan explorer deep-links verified via the public Hedera Mirror Node (<code className="text-xs">testnet.mirrornode.hedera.com</code>).
            </p>
          </Card>
        </div>
      </div>

      {/* Payment Safeguards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <ShieldCheck className="h-5 w-5 text-[#3867F6]" />
          <h2 className="mt-3 font-semibold text-[#172B4D]">Autonomous Payment Safeguards</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Enforces strict integer tinybars (zero float math), per-payment cap (max 5 HBAR), daily budget ceiling (max 25 HBAR), and recipient provider allowlisting.
          </p>
        </Card>

        <Card>
          <Clock3 className="h-5 w-5 text-[#3867F6]" />
          <h2 className="mt-3 font-semibold text-[#172B4D]">Settlement History & Mirror Node</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            A payment or record is marked <strong>VERIFIED</strong> only when the public Mirror Node confirms it on Hedera Testnet. No unverified claims are accepted.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function AgentPaymentsPage() {
  return (
    <AuthGate>
      <AgentPayments />
    </AuthGate>
  );
}
