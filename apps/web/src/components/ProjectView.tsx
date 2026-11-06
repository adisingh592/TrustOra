"use client";

import type { ReactNode } from "react";
import { useProject, type ProjectResponse } from "@/hooks/useProject";
import { ApiError } from "@/lib/api";
import { Empty, ErrorState, PageSkeleton } from "./bits";

/** Loads a project and renders children with it; handles loading, 404 and errors uniformly. */
export function ProjectView({ id, children }: { id: string; children: (detail: ProjectResponse) => ReactNode }) {
  const q = useProject(id);
  if (q.isLoading) return <PageSkeleton />;
  if (q.error) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    if (notFound) return <Empty title="Project not found">It does not exist, or your wallet is not a participant.</Empty>;
    return <ErrorState title="Could not load this project" message={q.error.message} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return null;
  return <>{children(q.data)}</>;
}
