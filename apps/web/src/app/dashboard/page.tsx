"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Card, Empty, ErrorState, PageSkeleton } from "@/components/bits";
import { StatusPanel } from "@/components/StatusPanel";
import { useProjects } from "@/hooks/useProjects";
import { formatUsdc } from "@/lib/format";
import { nextStepFor } from "@/lib/workflow";

const IN_ESCROW = ["FUNDED", "SUBMITTED", "REVISION_REQUESTED", "DISPUTED"];

function Dashboard() {
  const q = useProjects();
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState title="Could not load your projects" message={q.error.message} onRetry={() => void q.refetch()} />;
  const projects = q.data ?? [];
  const clientProjects = projects.filter((p) => p.roles.includes("client"));
  const freelancerProjects = projects.filter((p) => p.roles.includes("freelancer"));
  const invitations = freelancerProjects.filter((p) => !p.agreementVersions[0]?.freelancerAccepted);

  const inEscrow = projects.reduce((sum, p) => (p.roles.includes("client") ? sum + p.milestones.filter((m) => IN_ESCROW.includes(m.state)).reduce((s, m) => s + m.amountUsdc, 0) : sum), 0);
  const released = projects.reduce((sum, p) => sum + p.milestones.filter((m) => m.state === "RELEASED").reduce((s, m) => s + m.amountUsdc, 0), 0);
  const attention = projects
    .map((p) => ({ p, step: nextStepFor({ registerTxHash: p.registerTxHash, agreement: p.agreementVersions[0] ?? null, milestones: p.milestones }, p.roles) }))
    .filter((x) => x.step);

  const stats = [
    { label: "Client projects", value: String(clientProjects.length) },
    { label: "Freelancer projects", value: String(freelancerProjects.length) },
    { label: "In escrow (as client)", value: `${formatUsdc(inEscrow)} USDC` },
    { label: "Released", value: `${formatUsdc(released)} USDC` },
    { label: "Needs your action", value: String(attention.length) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">Workspace overview</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Dashboard</h1></div>
        <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-lg bg-[#3867F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2854DB]"><Plus className="h-4 w-4" /> New project</Link>
      </div>

      <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2 border-b border-[#E5EAF1] pb-4">
        <a href="#client-projects" className="rounded-lg border border-[#E5EAF1] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-[#3867F6]">My Client Projects <span className="ml-1 text-slate-400">{clientProjects.length}</span></a>
        <a href="#freelancer-projects" className="rounded-lg border border-[#E5EAF1] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-[#3867F6]">My Freelancer Projects <span className="ml-1 text-slate-400">{freelancerProjects.length}</span></a>
        {invitations.length > 0 && <a href="#freelancer-projects" className="rounded-lg bg-[#EEF3F8] px-3 py-2 text-sm font-medium text-[#2854DB]">Agreements to review · {invitations.length}</a>}
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}><p className="text-xs font-medium text-slate-500">{s.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#172B4D]">{s.value}</p></Card>
        ))}
      </div>

      <StatusPanel />

      <section id="client-projects" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#3867F6]">Client workspace</p><h2 className="mt-1 text-xl font-semibold text-[#172B4D]">My Client Projects</h2></div><Link href="/projects/new" className="text-sm font-medium text-[#3867F6]">Create project</Link></div>
        {clientProjects.length === 0 ? <Empty title="No client projects">Projects you create as the client appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{clientProjects.map((p)=><Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover rounded-xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{p.id}</p><h3 className="mt-1 font-semibold text-[#172B4D]">{p.title}</h3><p className="mt-1 text-xs text-slate-500">Freelancer {p.freelancerAddress ? p.freelancerAddress.slice(0,6)+"…"+p.freelancerAddress.slice(-4) : "Not assigned"}</p></div><span className="rounded-full bg-[#EEF3F8] px-2.5 py-1 text-xs font-medium text-slate-600">{p.status.replaceAll("_"," ")}</span></div><div className="mt-4 flex items-center justify-between border-t border-[#E5EAF1] pt-3 text-sm"><span className="text-slate-500">{p.milestones.filter(m=>m.state==="RELEASED").length}/{p.milestones.length} milestones released</span><span className="font-semibold text-[#172B4D]">{formatUsdc(p.budgetUsdc)} USDC</span></div></Link>)}</div>}
      </section>

      <section id="freelancer-projects" className="scroll-mt-24 space-y-3">
        <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#3867F6]">Freelancer workspace</p><h2 className="mt-1 text-xl font-semibold text-[#172B4D]">My Freelancer Projects</h2><p className="mt-1 text-sm text-slate-500">Projects assigned to your authenticated wallet. Review and sign pending agreements to accept the invitation.</p></div>
        {freelancerProjects.length === 0 ? <Empty title="No freelancer projects or invitations">When a client assigns your wallet, the project and agreement will appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{freelancerProjects.map((p)=>{const pending=!p.agreementVersions[0]?.freelancerAccepted;return <Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover rounded-xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{p.id}</p><h3 className="mt-1 font-semibold text-[#172B4D]">{p.title}</h3><p className="mt-1 text-xs text-slate-500">Client {p.clientAddress.slice(0,6)}…{p.clientAddress.slice(-4)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${pending?"bg-amber-50 text-amber-800":"bg-emerald-50 text-emerald-700"}`}>{pending?"Invitation · signature needed":"Agreement signed"}</span></div><div className="mt-4 flex items-center justify-between border-t border-[#E5EAF1] pt-3 text-sm"><span className="text-slate-500">{p.milestones.filter(m=>m.state==="RELEASED").length}/{p.milestones.length} milestones paid</span><span className="font-semibold text-[#172B4D]">{formatUsdc(p.budgetUsdc)} USDC</span></div><p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#3867F6]">{pending?"Review invitation and agreement":"Open freelancer workspace"}<ArrowRight className="h-4 w-4"/></p></Link>})}</div>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-[#172B4D]">Needs your action</h2>
        {attention.length === 0 ? (
          <Empty title="You're all caught up">Nothing is waiting on your wallet right now.</Empty>
        ) : (
          <div className="space-y-3">
            {attention.map(({ p, step }) => (
              <Link key={p.id} href={`/projects/${p.id}/${step!.tab}`} className="glass-card glass-card-hover flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                <div>
                  <p className="font-medium text-[#172B4D]">{p.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{step!.text}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-[#3867F6]" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#172B4D]">Recent projects</h2>
          <Link href="/projects" className="text-sm font-medium text-[#3867F6] hover:underline">View all</Link>
        </div>
        {projects.length === 0 ? (
          <Empty title="No projects yet">Create one to lock your first milestone in escrow.<div className="mt-4"><Link href="/projects/new" className="rounded-lg bg-[#3867F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2854DB]">Create a project</Link></div></Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.slice(0, 4).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover rounded-xl p-4">
                <p className="font-medium text-[#172B4D]">{p.title}</p>
                <p className="mt-1 text-xs text-slate-400">{p.status.replace("_", " ")} · {formatUsdc(p.budgetUsdc)} USDC · {p.roles.join(", ")}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthGate><Dashboard /></AuthGate>;
}
