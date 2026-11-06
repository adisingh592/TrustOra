// Mirror of the shared integration vocabulary. Swap for `packages/shared` imports once M2 publishes.
export type IntegrationStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTED"
  | "VERIFIED"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "BLOCKED";

export interface IntegrationHealth {
  status: IntegrationStatus;
  detail: string;
  checkedAt: string;
}

export interface OgChatRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export type RequestIdSource = "x_0g_trace.request_id" | "ZG-Res-Key" | "body.id" | "broker.chatID";

export interface OgChatResponse {
  content: string;
  /** A 0G INFERENCE_REQUEST_ID. NOT a transaction hash. Never link to an explorer. */
  requestId: string;
  requestIdSource: RequestIdSource;
  chatId: string | null;
  modelId: string | null;
  providerAddress: string | null;
  /** The ROUTER's claim (router path) or independent SDK check (broker path). null = unknown. */
  teeVerified: boolean | null;
  teeVerifiedBy: "router-reported" | "sdk-independent" | null;
  trustModeRequested: string | null;
}

export type OgErrorCode =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "INSUFFICIENT_FUNDS"
  | "NO_REQUEST_ID"
  | "BAD_RESPONSE";

export class OgError extends Error {
  readonly code: OgErrorCode;
  constructor(code: OgErrorCode, message: string) {
    super(message);
    this.name = "OgError";
    this.code = code;
  }
}

export interface OgChatClient {
  chat(req: OgChatRequest): Promise<OgChatResponse>;
  healthCheck(): Promise<IntegrationHealth>;
}
