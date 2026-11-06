"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Card, Empty, ErrorState, PageSkeleton } from "@/components/bits";
import { StatusPanel } from "@/components/StatusPanel";
import { useProjects, type ProjectSummary } from "@/hooks/useProjects";
import { useAuth } from "@/components/AuthProvider";
import { formatUsdc } from "@/lib/format";
import { nextStepFor } from "@/lib/workflow";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const IN_ESCROW = ["FUNDED", "SUBMITTED", "REVISION_REQUESTED", "DISPUTED"];

function Dashboard() {
  const q = useProjects();
  const auth = useAuth();
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState title="Could not load your projects" message={q.error.message} onRetry={() => void q.refetch()} />;
  const projects = q.data ?? [];
  if (auth.accountRole === "FREELANCER") return <FreelancerDashboard projects={projects} />;
  const clientProjects = projects.filter((p) => p.roles.includes("client"));

  const inEscrow = projects.reduce((sum, p) => (p.roles.includes("client") ? sum + p.milestones.filter((m) => IN_ESCROW.includes(m.state)).reduce((s, m) => s + m.amountUsdc, 0) : sum), 0);
  const released = projects.reduce((sum, p) => sum + p.milestones.filter((m) => m.state === "RELEASED").reduce((s, m) => s + m.amountUsdc, 0), 0);
  const attention = projects
    .map((p) => ({ p, step: nextStepFor({ registerTxHash: p.registerTxHash, agreement: p.agreementVersions[0] ?? null, milestones: p.milestones }, p.roles) }))
    .filter((x) => x.step);

  const stats = [
    { label: "Client projects", value: String(clientProjects.length) },
    { label: "In escrow (as client)", value: `${formatUsdc(inEscrow)} USDC` },
    { label: "Released", value: `${formatUsdc(released)} USDC` },
    { label: "Needs your action", value: String(attention.length) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">Workspace overview</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Dashboard</h1></div>
        {auth.accountRole === "CLIENT" && <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-lg bg-[#3867F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2854DB]"><Plus className="h-4 w-4" /> New project</Link>}
      </div>

      <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2 border-b border-[#E5EAF1] pb-4">
        {auth.accountRole === "CLIENT" && <a href="#client-projects" className="rounded-lg border border-[#E5EAF1] bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-[#3867F6]">My Client Projects <span className="ml-1 text-slate-400">{clientProjects.length}</span></a>}
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}><p className="text-xs font-medium text-slate-500">{s.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#172B4D]">{s.value}</p></Card>
        ))}
      </div>

      <StatusPanel />

      {projects.some((p) => p.status === "DRAFT") && <Card><h2 className="font-semibold text-[#172B4D]">Draft projects</h2><p className="mt-1 text-sm text-slate-500">Publish a draft when you are ready for eligible freelancers to discover it.</p><div className="mt-3 space-y-2">{projects.filter((p) => p.status === "DRAFT").map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5EAF1] p-3"><span className="text-sm font-medium">{p.title}</span><PublishButton projectId={p.id} /></div>)}</div></Card>}

      {auth.accountRole === "CLIENT" && <section id="client-projects" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#3867F6]">Client workspace</p><h2 className="mt-1 text-xl font-semibold text-[#172B4D]">My Client Projects</h2></div><Link href="/projects/new" className="text-sm font-medium text-[#3867F6]">Create project</Link></div>
        {clientProjects.length === 0 ? <Empty title="No client projects">Projects you create as the client appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{clientProjects.map((p)=><Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover rounded-xl p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{p.id}</p><h3 className="mt-1 font-semibold text-[#172B4D]">{p.title}</h3><p className="mt-1 text-xs text-slate-500">Freelancer {p.freelancerAddress ? p.freelancerAddress.slice(0,6)+"…"+p.freelancerAddress.slice(-4) : "Not assigned"}</p></div><span className="rounded-full bg-[#EEF3F8] px-2.5 py-1 text-xs font-medium text-slate-600">{p.status.replaceAll("_"," ")}</span></div><div className="mt-4 flex items-center justify-between border-t border-[#E5EAF1] pt-3 text-sm"><span className="text-slate-500">{p.milestones.filter(m=>m.state==="RELEASED").length}/{p.milestones.length} milestones released</span><span className="font-semibold text-[#172B4D]">{formatUsdc(p.budgetUsdc)} USDC</span></div></Link>)}</div>}
      </section>}

      {auth.accountRole === "CLIENT" && <ClientApplications />}

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

function PublishButton({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <span className="flex items-center gap-2">{error && <span className="text-xs text-rose-600">{error}</span>}<button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await api(`/api/projects/${projectId}/publish`, { method: "POST", body: {} }); await queryClient.invalidateQueries({ queryKey: ["projects"] }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }} className="rounded-lg bg-[#3867F6] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Publishing…" : "Publish"}</button></span>;
}

function FreelancerDashboard({ projects }: { projects: Array<ProjectSummary & { roles: string[] }> }) {
  const applications = useQuery({
    queryKey: ["my-applications"],
    queryFn: () => api<{ applications: Array<{ id: string; status: string; createdAt: string; project: { id: string; title: string; status: string; budgetUsdc: number } }> }>("/api/applications/mine"),
  });
  const invitations = projects.filter((p) => p.roles.includes("freelancer") && !p.agreementVersions[0]?.freelancerAccepted);
  const active = projects.filter((p) => p.roles.includes("freelancer") && p.agreementVersions[0]?.freelancerAccepted);
  const submitted = active.reduce((n, p) => n + p.milestones.filter((m) => m.state === "SUBMITTED").length, 0);
  const paid = active.reduce((n, p) => n + p.milestones.filter((m) => m.state === "RELEASED").reduce((s, m) => s + m.amountUsdc, 0), 0);
  return (
    <div className="space-y-8">
      <div><p className="text-sm text-slate-500">Freelancer workspace</p><h1 className="mt-1 text-3xl font-semibold text-[#172B4D]">Your work</h1><p className="mt-2 text-sm text-slate-600">Find opportunities, manage invitations, and submit verified deliverables.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><p className="text-xs text-slate-500">Invitations</p><p className="mt-2 text-2xl font-semibold">{invitations.length}</p></Card>
        <Card><p className="text-xs text-slate-500">Active contracts</p><p className="mt-2 text-2xl font-semibold">{active.length}</p></Card>
        <Card><p className="text-xs text-slate-500">Submitted for review</p><p className="mt-2 text-2xl font-semibold">{submitted}</p></Card>
        <Card><p className="text-xs text-slate-500">Verified paid milestones</p><p className="mt-2 text-2xl font-semibold">{formatUsdc(paid)} USDC</p></Card>
      </div>
      <div className="flex flex-wrap gap-3"><Link href="/marketplace" className="rounded-lg bg-[#3867F6] px-4 py-2.5 text-sm font-semibold text-white">Explore Marketplace</Link><Link href="/projects" className="rounded-lg border border-[#E5EAF1] px-4 py-2.5 text-sm font-semibold text-slate-700">My Contracts</Link></div>
      <section className="space-y-3"><h2 className="text-xl font-semibold text-[#172B4D]">My applications</h2>{applications.isLoading ? <PageSkeleton rows={2} /> : applications.error ? <ErrorState title="Could not load applications" message={applications.error.message} onRetry={() => void applications.refetch()} /> : applications.data?.applications.length ? <div className="grid gap-3 lg:grid-cols-2">{applications.data.applications.map((application) => <Card key={application.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-[#172B4D]">{application.project.title}</p><p className="mt-1 text-xs text-slate-500">{new Date(application.createdAt).toLocaleDateString()} · {formatUsdc(application.project.budgetUsdc)} USDC</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{application.status}</span></div></Card>)}</div> : <Empty title="No applications yet">Explore the marketplace to find published opportunities.</Empty>}</section>
      <section className="space-y-3"><h2 className="text-xl font-semibold text-[#172B4D]">Invitations and contracts</h2>{projects.length === 0 ? <Empty title="No invitations yet">Published opportunities and direct client invitations will appear here.</Empty> : <div className="grid gap-3 lg:grid-cols-2">{projects.map((p) => <Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover rounded-xl p-5"><p className="font-mono text-xs text-slate-500">{p.id}</p><h3 className="mt-1 font-semibold text-[#172B4D]">{p.title}</h3><p className="mt-2 text-sm text-slate-500">{p.agreementVersions[0]?.freelancerAccepted ? "Active contract" : "Invitation · agreement signature needed"}</p><p className="mt-3 text-sm font-semibold">{formatUsdc(p.budgetUsdc)} USDC · {p.milestones.length} milestones</p></Link>)}</div>}</section>
    </div>
  );
}

type ReceivedApplication = { id: string; applicantAddress: string; message: string | null; status: string; createdAt: string; project: { id: string; title: string; status: string } };

function ClientApplications() {
  const queryClient = useQueryClient();
  const applications = useQuery({ queryKey: ["received-applications"], queryFn: () => api<{ applications: ReceivedApplication[] }>("/api/applications/received") });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(application: ReceivedApplication, action: "approve" | "reject") {
    setBusy(application.id); setError(null);
    try {
      await api(`/api/projects/${application.project.id}/applications/${application.id}`, { method: action === "approve" ? "POST" : "DELETE", body: {} });
      await queryClient.invalidateQueries({ queryKey: ["received-applications"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  return <section id="applications" className="scroll-mt-24 space-y-3"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#3867F6]">Client workspace</p><h2 className="mt-1 text-xl font-semibold text-[#172B4D]">Applications received</h2></div>{applications.isLoading ? <PageSkeleton rows={2} /> : applications.error ? <ErrorState title="Could not load applications" message={applications.error.message} onRetry={() => void applications.refetch()} /> : applications.data?.applications.length ? <div className="space-y-3">{applications.data.applications.map((application) => <Card key={application.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-[#172B4D]">{application.project.title}</p><p className="mt-1 font-mono text-xs text-slate-500">{application.applicantAddress}</p><p className="mt-1 text-xs text-slate-500">Applied {new Date(application.createdAt).toLocaleDateString()} · {application.status}</p>{application.message && <p className="mt-3 text-sm text-slate-600">{application.message}</p>}</div><div className="flex items-center gap-2">{application.status === "PENDING" ? <><button type="button" disabled={busy === application.id} onClick={() => void decide(application, "approve")} className="rounded-lg bg-[#3867F6] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy === application.id} onClick={() => void decide(application, "reject")} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Reject</button></> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{application.status}</span>}</div></div></Card>)}</div> : <Empty title="No applications received">Applications from freelancers will appear here after you publish a project.</Empty>}{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}</section>;
}

export default function DashboardPage() {
  return <AuthGate><Dashboard /></AuthGate>;
}
