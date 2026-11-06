"use client";

import { useParams } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { Workspace } from "@/components/Workspace";

/** The default project view follows the authenticated wallet's database-backed role. */
export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  return <ProjectView id={id}>{(detail) => {
    const role = detail.viewer.roles.includes("client")
      ? "client"
      : detail.viewer.roles.includes("freelancer")
        ? "freelancer"
        : "arbiter";
    return <Workspace detail={detail} view={role} />;
  }}</ProjectView>;
}
