"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { Workspace } from "@/components/Workspace";

/** The default project view follows the authenticated wallet's database-backed role. */
export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id === "TRU-PROJ-2026-0001043") {
      router.replace("/projects/TRU-PROJ-2026-0001050");
    }
  }, [id, router]);

  if (id === "TRU-PROJ-2026-0001043") return null;

  return <ProjectView id={id}>{(detail) => {
    const role = detail.viewer.roles.includes("client")
      ? "client"
      : detail.viewer.roles.includes("freelancer")
        ? "freelancer"
        : "arbiter";
    return <Workspace detail={detail} view={role} />;
  }}</ProjectView>;
}
