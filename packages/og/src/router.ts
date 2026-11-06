import {
  OgError,
  type IntegrationHealth,
  type OgChatClient,
  type OgChatRequest,
  type OgChatResponse,
  type RequestIdSource,
} from "./types";

export const TESTNET_ROUTER_BASE_URL = "https://router-api-testnet.integratenetwork.work/v1";
/** Mainnet router host. TRUSTORA is testnet-only: config refuses it. */
export const MAINNET_ROUTER_HOST = "router-api.0g.ai";

export interface RouterConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  /** UNVERIFIED header value (e.g. "private"); only sent when explicitly configured. */
  trustMode?: string;
  providerAddress?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function assertNotMainnet(baseUrl: string): void {
  let host = "";
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { throw new OgError("NOT_CONFIGURED", "ZG_ROUTER_BASE_URL is not a valid URL"); }
  if (host === MAINNET_ROUTER_HOST || host.endsWith(`.${MAINNET_ROUTER_HOST}`)) {
    throw new OgError("NOT_CONFIGURED", "Refusing 0G mainnet router URL: TRUSTORA is testnet-only");
  }
}

export function routerConfigFromEnv(env: Record<string, string | undefined>): RouterConfig | null {
  const apiKey = env.ZG_ROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.ZG_ROUTER_BASE_URL?.trim() || TESTNET_ROUTER_BASE_URL).replace(/\/+$/, "");
  assertNotMainnet(baseUrl);
  const cfg: RouterConfig = { apiKey, baseUrl };
  if (env.ZG_ROUTER_MODEL?.trim()) cfg.model = env.ZG_ROUTER_MODEL.trim();
  if (env.ZG_ROUTER_TRUST_MODE?.trim()) cfg.trustMode = env.ZG_ROUTER_TRUST_MODE.trim();
  if (env.ZG_ROUTER_PROVIDER_ADDRESS?.trim()) cfg.providerAddress = env.ZG_ROUTER_PROVIDER_ADDRESS.trim();
  return cfg;
}

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export class RouterClient implements OgChatClient {
  private readonly cfg: RouterConfig;
  private readonly fetchImpl: typeof fetch;
  private resolvedModel: string | undefined;

  constructor(cfg: RouterConfig) {
    assertNotMainnet(cfg.baseUrl);
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, "") };
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.resolvedModel = cfg.model;
  }

  private redact(text: string): string {
    return text.split(this.cfg.apiKey).join("[REDACTED]").slice(0, 300);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      authorization: `Bearer ${this.cfg.apiKey}`,
      "content-type": "application/json",
    };
    if (this.cfg.trustMode) h["x-0g-provider-trust-mode"] = this.cfg.trustMode;
    if (this.cfg.providerAddress) h["x-0g-provider-address"] = this.cfg.providerAddress;
    return h;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { ...init, signal: ctrl.signal });
    } catch (e) {
      const msg = ctrl.signal.aborted ? `timeout after ${timeoutMs}ms` : e instanceof Error ? e.message : "network error";
      throw new OgError("UNAVAILABLE", `0G router unreachable: ${this.redact(msg)}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new OgError("NOT_CONFIGURED", `0G router rejected the API key (HTTP ${res.status})`);
    if (res.status === 402) throw new OgError("INSUFFICIENT_FUNDS", "0G router reports insufficient funds (HTTP 402)");
    if (!res.ok) {
      const text = this.redact(await res.text().catch(() => ""));
      throw new OgError("UNAVAILABLE", `0G router error HTTP ${res.status}: ${text}`);
    }
    return res;
  }

  async listModels(timeoutMs = 15_000): Promise<string[]> {
    const res = await this.request("/models", { method: "GET", headers: this.headers() }, timeoutMs);
    const body: unknown = await res.json().catch(() => null);
    const data = isObj(body) && Array.isArray(body.data) ? body.data : null;
    if (!data) throw new OgError("BAD_RESPONSE", "GET /models did not return {data:[...]}");
    return data.map((m) => (isObj(m) ? asString(m.id) : null)).filter((x): x is string => x !== null);
  }

  private async model(): Promise<string> {
    if (this.resolvedModel) return this.resolvedModel;
    const first = (await this.listModels())[0];
    if (!first) throw new OgError("NOT_CONFIGURED", "No ZG_ROUTER_MODEL set and GET /models returned no models");
    this.resolvedModel = first;
    return first;
  }

  async chat(req: OgChatRequest): Promise<OgChatResponse> {
    const model = await this.model();
    const payload = {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      temperature: req.temperature ?? 0.1,
      max_tokens: req.maxTokens ?? 2000,
      verify_tee: true,
    };
    const res = await this.request(
      "/chat/completions",
      { method: "POST", headers: this.headers(), body: JSON.stringify(payload) },
      req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const body: unknown = await res.json().catch(() => null);
    if (!isObj(body)) throw new OgError("BAD_RESPONSE", "0G router returned a non-JSON body");
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0];
    const message = isObj(first) && isObj(first.message) ? first.message : null;
    const content = message ? asString(message.content) : null;
    if (content === null) throw new OgError("BAD_RESPONSE", "0G router response had no choices[0].message.content");

    const trace = isObj(body.x_0g_trace) ? body.x_0g_trace : null;
    const headerKey = asString(res.headers.get("ZG-Res-Key"));
    let requestId: string | null = null;
    let requestIdSource: RequestIdSource | null = null;
    const traceId = trace ? asString(trace.request_id) : null;
    const bodyId = asString(body.id);
    if (traceId) { requestId = traceId; requestIdSource = "x_0g_trace.request_id"; }
    else if (headerKey) { requestId = headerKey; requestIdSource = "ZG-Res-Key"; }
    else if (bodyId) { requestId = bodyId; requestIdSource = "body.id"; }
    if (!requestId || !requestIdSource) {
      throw new OgError("NO_REQUEST_ID", "0G response carried no x_0g_trace.request_id, ZG-Res-Key header, or body id");
    }

    const tee = trace && typeof trace.tee_verified === "boolean" ? trace.tee_verified : null;
    return {
      content,
      requestId,
      requestIdSource,
      chatId: headerKey ?? bodyId,
      modelId: asString(body.model) ?? model,
      providerAddress: (trace ? asString(trace.provider) : null) ?? this.cfg.providerAddress ?? null,
      teeVerified: tee,
      teeVerifiedBy: tee === null ? null : "router-reported",
      trustModeRequested: this.cfg.trustMode ?? null,
    };
  }

  /** CONFIGURED = reachable and key accepted. Never CONNECTED/VERIFIED: only a real inference earns CONNECTED. */
  async healthCheck(): Promise<IntegrationHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const models = await this.listModels(10_000);
      return { status: "CONFIGURED", detail: `router reachable, key accepted, ${models.length} model(s) listed`, checkedAt };
    } catch (e) {
      if (e instanceof OgError) {
        const status = e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE";
        return { status, detail: e.message, checkedAt };
      }
      return { status: "UNAVAILABLE", detail: "unknown error", checkedAt };
    }
  }
}
