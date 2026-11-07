"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ProjectView } from "@/components/ProjectView";
import { formatUsdc, shortAddress } from "@/lib/format";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "border-slate-300 text-slate-600", AGREED: "border-sky-200 text-sky-700", FUNDED: "border-indigo-200 text-indigo-700",
  IN_PROGRESS: "border-amber-200 text-amber-800", COMPLETED: "border-emerald-200 text-emerald-700", DISPUTED: "border-rose-200 text-rose-700",
};

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  return (
    <AuthGate>
      <ProjectView id={id}>
        {({ project, viewer }) => {
          const base = `/projects/${project.id}`;
          const tabs = [
            { href: base, label: "Project Overview" },
            { href: `${base}/client`, label: "Client Workspace" },
            { href: `${base}/freelancer`, label: "Freelancer Workspace" },
            { href: `${base}/proof`, label: "ProofTrack Evidence" },
          ];
          return (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-slate-500">{project.id}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-[#172B4D]">{project.title}</h1>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[project.status] ?? STATUS_TONE.DRAFT}`}>{project.status.replace("_", " ")}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {formatUsdc(project.budgetUsdc)} USDC · client {shortAddress(project.clientAddress)} · freelancer {shortAddress(project.freelancerAddress)}
                  {project.arbiterAddress && <> · arbiter {shortAddress(project.arbiterAddress)}</>}
                  <span className="ml-2 text-slate-500">You are: {viewer.roles.join(", ")}</span>
                </p>
              </div>
              <nav className="flex gap-1 overflow-x-auto border-b border-[#E5EAF1]" aria-label="Project sections">
                {tabs.map((t) => {
                  const active = pathname === t.href;
                  return (
                    <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active ? "border-[#3867F6] text-[#2854DB]" : "border-transparent text-slate-600 hover:text-[#172B4D]"}`}>
                      {t.label}
                    </Link>
                  );
                })}
              </nav>
              {children}
            </div>
          );
        }}
      </ProjectView>
    </AuthGate>
  );
}

