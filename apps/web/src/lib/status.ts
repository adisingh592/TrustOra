/**
 * Honest availability of each integration, from configuration only (no network calls, no secret values).
 * CONFIGURED means "settings are present", never "verified working": reachability is proven only by a real
 * transaction or inference. The UI uses this to disable features instead of pretending they work.
 */
import { routerConfigFromEnv } from "../../../../packages/og/src/index";

export type Availability = "CONFIGURED" | "NOT_CONFIGURED" | "NOT_IMPLEMENTED" | "BLOCKED";

export interface IntegrationStatus {
  status: Availability;
  /** Safe to show to any user: never contains a key, address from env, or URL from env. */
  detail: string;
}

export interface SystemStatus {
  arcEscrow: IntegrationStatus;
  zeroG: IntegrationStatus;
  hedera: IntegrationStatus;
}

export function getSystemStatus(env: Record<string, string | undefined> = process.env): SystemStatus {
  const escrow = env.ESCROW_CONTRACT_ADDRESS?.trim();
  const arcEscrow: IntegrationStatus = !escrow
    ? { status: "NOT_CONFIGURED", detail: "The escrow contract is not deployed or configured on this server, so on-chain actions are disabled." }
    : /^0x[0-9a-fA-F]{40}$/.test(escrow) && !/^0x0{40}$/i.test(escrow)
      ? { status: "CONFIGURED", detail: "An escrow contract address is configured. Each transaction is still verified against Arc before it is recorded." }
      : { status: "BLOCKED", detail: "ESCROW_CONTRACT_ADDRESS is set but is not a valid address, so on-chain actions are disabled." };

  let zeroG: IntegrationStatus;
  try {
    if (routerConfigFromEnv(env)) {
      zeroG = { status: "CONFIGURED", detail: "A 0G router key is configured. Evaluations are advisory and return UNABLE_TO_ASSESS if the provider is unreachable." };
    } else if (env.ZG_PRIVATE_KEY?.trim()) {
      zeroG = { status: "NOT_CONFIGURED", detail: "Only the 0G broker fallback is set, which needs an SDK that is not installed in this build. Evaluations will report UNABLE_TO_ASSESS." };
    } else {
      zeroG = { status: "NOT_CONFIGURED", detail: "No 0G credentials are configured. AI evaluation will honestly report UNABLE_TO_ASSESS." };
    }
  } catch {
    zeroG = { status: "BLOCKED", detail: "The configured 0G endpoint was refused (TRUSTORA is testnet-only), so AI evaluation is disabled." };
  }

  const hedera: IntegrationStatus = {
    status: "NOT_IMPLEMENTED",
    detail: "The Hedera x402 settlement flow is not wired into the application. No payment is attempted or reported.",
  };
  return { arcEscrow, zeroG, hedera };
}
