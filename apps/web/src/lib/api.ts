/** Thin typed fetch wrapper for the TRUSTORA API. Cookies carry the session; nothing secret is in JS. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`, json?.code);
  }
  return json as T;
}
