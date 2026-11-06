"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SystemStatus } from "@/lib/status";

/** Which integrations are configured on the server (no secrets). Used to disable, not fake, unavailable features. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: async () => (await api<{ status: SystemStatus }>("/api/status")).status,
    staleTime: 60_000,
  });
}
