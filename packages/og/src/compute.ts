// FALLBACK path: 0G Compute broker SDK (@0gfoundation/0g-compute-ts-sdk). Router (router.ts) is PRIMARY.
// Every SDK method name below is UNVERIFIED until a first real run; fix ONLY in this file.
// The SDK and ethers are loaded lazily via non-literal dynamic import so the package typechecks without them.
import { OgError, type IntegrationHealth, type OgChatClient, type OgChatRequest, type OgChatResponse } from "./types";

export const MAINNET_RPC_HOST = "evmrpc.0g.ai";
/** UNVERIFIED default testnet RPC; override with ZG_RPC_URL. */
export const DEFAULT_TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
const SDK_MODULE = "@0gfoundation/0g-compute-ts-sdk";
const ETHERS_MODULE = "ethers";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BrokerLike {
  inference: {
    listService(): Promise<any[]>;
    getServiceMetadata(provider: string): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(provider: string, content: string): Promise<Record<string, string>>;
    processResponse(provider: string, chatID: string, usage?: string): Promise<boolean | null | undefined>;
  };
}
export interface BrokerModules {
  createBroker(privateKey: string, rpcUrl: string): Promise<BrokerLike>;
  fetchImpl?: typeof fetch;
}

const dynImport = (spec: string): Promise<any> => import(/* @vite-ignore */ /* webpackIgnore: true */ spec);

const defaultModules: BrokerModules = {
  async createBroker(privateKey, rpcUrl) {
    let ethers: any;
    let sdk: any;
    try {
      ethers = await dynImport(ETHERS_MODULE);
      sdk = await dynImport(SDK_MODULE);
    } catch {
      throw new OgError("NOT_CONFIGURED", `Broker path needs "${ETHERS_MODULE}" and "${SDK_MODULE}" (not installed). Never install @0glabs/0g-serving-broker.`);
    }
    const wallet = new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl));
    return sdk.createZGComputeNetworkBroker(wallet) as Promise<BrokerLike>;
  },
};

export interface BrokerConfig {
  privateKey: string;
  rpcUrl?: string;
  providerAddress?: string;
  modules?: BrokerModules;
}

export function assertNotMainnetRpc(rpcUrl: string): void {
  let host = "";
  try { host = new URL(rpcUrl).hostname.toLowerCase(); } catch { throw new OgError("NOT_CONFIGURED", "ZG_RPC_URL is not a valid URL"); }
  if (host === MAINNET_RPC_HOST) throw new OgError("NOT_CONFIGURED", "Refusing 0G mainnet RPC: TRUSTORA is testnet-only");
}

export class BrokerClient implements OgChatClient {
  private readonly cfg: BrokerConfig;
  private readonly modules: BrokerModules;
  private broker: BrokerLike | undefined;

  constructor(cfg: BrokerConfig) {
    this.cfg = cfg;
    this.modules = cfg.modules ?? defaultModules;
    assertNotMainnetRpc(cfg.rpcUrl ?? DEFAULT_TESTNET_RPC);
  }

  private async getBroker(): Promise<BrokerLike> {
    if (!this.broker) this.broker = await this.modules.createBroker(this.cfg.privateKey, this.cfg.rpcUrl ?? DEFAULT_TESTNET_RPC);
    return this.broker;
  }

  private async pickProvider(b: BrokerLike): Promise<string> {
    if (this.cfg.providerAddress) return this.cfg.providerAddress;
    const services = await b.inference.listService();
    const s = services[0];
    const addr = s && typeof s === "object" ? (s.provider ?? s[0]) : undefined;
    if (typeof addr !== "string" || !addr) throw new OgError("UNAVAILABLE", "No 0G compute provider listed");
    return addr;
  }

  async chat(req: OgChatRequest): Promise<OgChatResponse> {
    const b = await this.getBroker();
    const provider = await this.pickProvider(b);
    const { endpoint, model } = await b.inference.getServiceMetadata(provider);
    const headers = await b.inference.getRequestHeaders(provider, req.user);
    const doFetch = this.modules.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await doFetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
          temperature: req.temperature ?? 0.1,
          max_tokens: req.maxTokens ?? 2000,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new OgError("UNAVAILABLE", `0G provider unreachable: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new OgError("NOT_CONFIGURED", `0G provider rejected request (HTTP ${res.status})`);
    if (res.status === 402) throw new OgError("INSUFFICIENT_FUNDS", "0G provider reports insufficient funds");
    if (!res.ok) throw new OgError("UNAVAILABLE", `0G provider error HTTP ${res.status}`);
    const body: any = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new OgError("BAD_RESPONSE", "provider response had no choices[0].message.content");
    const chatID = res.headers.get("ZG-Res-Key") ?? (typeof body.id === "string" ? body.id : null);
    if (!chatID) throw new OgError("NO_REQUEST_ID", "provider response carried no ZG-Res-Key header or body id");

    let valid: boolean | null = null;
    try {
      const v = await b.inference.processResponse(provider, chatID, body.usage ? JSON.stringify(body.usage) : undefined);
      valid = typeof v === "boolean" ? v : null;
    } catch {
      valid = null; // check could not run -> unknown, not false
    }
    return {
      content,
      requestId: chatID,
      requestIdSource: "broker.chatID",
      chatId: chatID,
      modelId: typeof body.model === "string" ? body.model : model,
      providerAddress: provider,
      teeVerified: valid,
      teeVerifiedBy: valid === null ? null : "sdk-independent",
      trustModeRequested: null,
    };
  }

  async healthCheck(): Promise<IntegrationHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const b = await this.getBroker();
      const n = (await b.inference.listService()).length;
      return { status: "CONFIGURED", detail: `broker initialised, ${n} provider(s) listed`, checkedAt };
    } catch (e) {
      const status = e instanceof OgError && e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE";
      return { status, detail: e instanceof Error ? e.message : "unknown error", checkedAt };
    }
  }
}
