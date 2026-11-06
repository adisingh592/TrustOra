"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { rolesOf, type ProjectRole } from "@/lib/authz";

export interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  budgetUsdc: number;
  clientAddress: string;
  freelancerAddress: string | null;
  arbiterAddress: string | null;
  registerTxHash: string | null;
  createdAt: string;
  agreementVersions: Array<{ clientAccepted: boolean; freelancerAccepted: boolean; isLocked: boolean }>;
  milestones: Array<{ id: string; milestoneIndex: number; state: string; amountUsdc: number }>;
}

/** Projects the signed-in wallet participates in, each with the roles that wallet holds. */
export function useProjects() {
  const auth = useAuth();
  return useQuery({
    queryKey: ["projects", auth.sessionAddress],
    queryFn: async () => {
      const r = await api<{ address: string; projects: ProjectSummary[] }>("/api/projects");
      return r.projects.map((p) => ({ ...p, roles: rolesOf(r.address, p) as ProjectRole[] }));
    },
    enabled: auth.status === "authenticated" && !auth.walletMismatch,
  });
}
