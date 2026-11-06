"use client";

import { useParams } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { ProofTimeline } from "@/components/ProofTimeline";
import { Card } from "@/components/bits";
import { arcAddressUrl } from "@/lib/format";

export default function ProofPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProjectView id={id}>
      {({ project, chain }) => (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-[#172B4D]">ProofTrack activity</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Every Arc entry below was confirmed by the server against the chain (receipt, escrow event, sender role and contract state) before it was recorded.
              Vendor-reported items, such as an AI request ID, are marked pending because they are not blockchain transactions.
            </p>
          </div>
          {chain.escrowAddress && (
            <Card className="text-sm text-slate-700">
              Escrow contract:{" "}
              <a href={arcAddressUrl(chain.escrowAddress)} target="_blank" rel="noreferrer" className="font-mono text-arc-light hover:underline">{chain.escrowAddress}</a>
            </Card>
          )}
          <ProofTimeline events={project.proofTrackEvents} />
        </div>
      )}
    </ProjectView>
  );
}
