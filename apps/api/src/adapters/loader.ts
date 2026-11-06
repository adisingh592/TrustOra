import type {
  EscrowAdapter,
  EvaluationAdapter,
  EvaluationInput,
  EvaluationResult,
  IntegrationHealth,
} from "@trustora/shared";
import { MOCK_ChainAdapter } from "@trustora/prooftrack";

export interface LoadedAdapters {
  chainAdapter: EscrowAdapter;
  evaluationAdapter: EvaluationAdapter | null;
  chainMode: "mock" | "arc";
  evaluationMode: "heuristic" | "zerog";
}

export class MockEvaluationAdapter implements EvaluationAdapter {
  async evaluate(_input: EvaluationInput): Promise<EvaluationResult> {
    throw new Error("MockEvaluationAdapter: evaluate not implemented, TAEVA uses heuristic fallback");
  }

  async health(): Promise<IntegrationHealth> {
    return {
      status: "NOT_CONFIGURED",
      detail: "MOCK evaluation adapter",
      checkedAt: new Date().toISOString(),
    };
  }
}

export const loadAdapters = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedAdapters> => {
  const chainMode = (env.CHAIN_ADAPTER?.toLowerCase() || "mock") as "mock" | "arc";
  const evaluationMode = (env.EVALUATION_ADAPTER?.toLowerCase() || "heuristic") as "heuristic" | "zerog";

  let chainAdapter: EscrowAdapter;
  if (chainMode === "arc") {
    const missing: string[] = [];
    if (!env.ARC_ESCROW_CONTRACT_ADDRESS) missing.push("ARC_ESCROW_CONTRACT_ADDRESS");
    if (!env.ARC_TESTNET_RPC_URL) missing.push("ARC_TESTNET_RPC_URL");
    if (!env.ARC_TESTNET_USDC_ADDRESS) missing.push("ARC_TESTNET_USDC_ADDRESS");
    if (!env.ARC_TESTNET_CHAIN_ID) missing.push("ARC_TESTNET_CHAIN_ID");

    if (missing.length > 0) {
      throw new Error(
        `Refusing to start with CHAIN_ADAPTER=arc: missing required variables: ${missing.join(", ")}`,
      );
    }

    try {
      // Dynamic import so stubs don't break mock builds
      const arcModule = await import("@trustora/arc" as string);
      if (typeof arcModule.createArcAdapter === "function") {
        chainAdapter = arcModule.createArcAdapter(env);
      } else if (arcModule.arcAdapter) {
        chainAdapter = arcModule.arcAdapter;
      } else {
        throw new Error("@trustora/arc does not export createArcAdapter or arcAdapter");
      }
    } catch (err) {
      throw new Error(
        `CHAIN_ADAPTER=arc was selected, but the real Arc adapter could not be loaded: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    // Default mock adapter with canned Arc testnet values
    chainAdapter = new MOCK_ChainAdapter({
      config: {
        chainId: 5042002,
        rpcUrl: env.ARC_TESTNET_RPC_URL || "https://testnet.arc.network/rpc",
        escrowAddress: env.ARC_ESCROW_CONTRACT_ADDRESS || `0x${"0".repeat(39)}4`,
        tokenAddress: env.ARC_TESTNET_USDC_ADDRESS || "0x3600000000000000000000000000000000000000",
        explorerBase: env.ARC_TESTNET_EXPLORER_URL || "https://testnet.arcscan.io",
      },
    });
  }

  let evaluationAdapter: EvaluationAdapter | null = null;
  if (evaluationMode === "zerog") {
    const missing: string[] = [];
    if (!env.ZG_RPC_URL && !env.ZG_STORAGE_CONTRACT) missing.push("ZG_RPC_URL or ZG_STORAGE_CONTRACT");

    if (missing.length > 0) {
      throw new Error(
        `Refusing to start with EVALUATION_ADAPTER=zerog: missing required variables: ${missing.join(", ")}`,
      );
    }

    try {
      const zgModule = await import("@trustora/evaluation" as string);
      if (typeof zgModule.createEvaluationAdapter === "function") {
        evaluationAdapter = zgModule.createEvaluationAdapter(env);
      } else if (zgModule.evaluationAdapter) {
        evaluationAdapter = zgModule.evaluationAdapter;
      } else {
        throw new Error("@trustora/evaluation does not export createEvaluationAdapter or evaluationAdapter");
      }
    } catch (err) {
      throw new Error(
        `EVALUATION_ADAPTER=zerog was selected, but the real 0G adapter could not be loaded: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    evaluationAdapter = new MockEvaluationAdapter();
  }

  return {
    chainAdapter,
    evaluationAdapter,
    chainMode,
    evaluationMode,
  };
};
