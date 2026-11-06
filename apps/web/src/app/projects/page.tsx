"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Empty, ErrorState, PageSkeleton, StateBadge } from "@/components/bits";
import { useProjects } from "@/hooks/useProjects";
import { formatUsdc, shortAddress } from "@/lib/format";

function List() {
  const q = useProjects();
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState title="Could not load your projects" message={q.error.message} onRetry={() => void q.refetch()} />;
  const projects = q.data ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">Your work, agreements and escrow</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#172B4D]">Projects</h1></div>
        <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-lg bg-[#3867F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2854DB]"><Plus className="h-4 w-4" /> New project</Link>
      </div>
      {projects.length === 0 ? (
        <Empty title="No projects yet">Projects where your wallet is the client, freelancer or arbiter appear here.<div className="mt-4"><Link href="/projects/new" className="rounded-lg bg-arc-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Create your first project</Link></div></Empty>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="glass-card glass-card-hover block rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">{p.id}</p>
                  <p className="mt-0.5 text-lg font-semibold text-[#172B4D]">{p.title}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    You: {p.roles.join(", ")} · client {shortAddress(p.clientAddress)} · freelancer {shortAddress(p.freelancerAddress)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-[#172B4D]">{formatUsdc(p.budgetUsdc)} USDC</p>
                  <p className="text-xs text-slate-400">{p.status.replace("_", " ")}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.milestones.map((m) => <span key={m.id} className="inline-flex items-center gap-1.5 text-xs text-slate-400">#{m.milestoneIndex} <StateBadge state={m.state} /></span>)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return <AuthGate><List /></AuthGate>;
}
