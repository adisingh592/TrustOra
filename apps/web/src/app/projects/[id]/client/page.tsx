"use client";

import { useParams } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { Workspace } from "@/components/Workspace";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ProjectView id={id}>{(detail) => <Workspace detail={detail} view="client" />}</ProjectView>;
}
