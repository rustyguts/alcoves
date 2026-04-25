export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;

  constructor(status: number, data: Record<string, unknown> | null) {
    const message =
      (data?.message as string) ??
      (data?.statusMessage as string) ??
      `Request failed with status ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  responseType?: "json" | "blob" | "text";
  headers?: Record<string, string>;
}

function resolveServerBase(): string {
  if (!import.meta.server) return "";
  try {
    const config = useRuntimeConfig();
    const apiUrl = (config.apiUrl as string) || "http://localhost:3001";
    return apiUrl.replace(/\/$/, "");
  } catch {
    return process.env.ALCOVES_API_URL || "http://localhost:3001";
  }
}

function resolveClientBase(): string {
  if (!import.meta.client) return "";
  try {
    const config = useRuntimeConfig();
    const apiOrigin = (config.public?.apiOrigin as string | undefined) ?? "";
    return apiOrigin.replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Prefix a relative API path with the appropriate base origin so the request
 * bypasses the Nuxt nitro dev proxy where possible. Already-absolute URLs
 * are returned unchanged.
 */
export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  if (import.meta.server) {
    return resolveServerBase() + path;
  }
  const base = resolveClientBase();
  return base ? base + path : path;
}

/**
 * True when the client should send credentials to the API origin.
 * Cross-origin requests need `credentials: "include"` to forward cookies.
 */
function clientUsesCrossOrigin(): boolean {
  if (!import.meta.client) return false;
  return resolveClientBase() !== "";
}

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, query, responseType = "json", headers = {} } = options;

  let fullUrl = url;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value);
    }
    const qs = params.toString();
    if (qs) fullUrl += (fullUrl.includes("?") ? "&" : "?") + qs;
  }

  if (!fullUrl.startsWith("http")) {
    fullUrl = apiUrl(fullUrl);
  }

  const finalHeaders: Record<string, string> = { ...headers };

  if (import.meta.server) {
    try {
      const reqHeaders = useRequestHeaders(["cookie"]);
      if (reqHeaders.cookie && !finalHeaders.cookie && !finalHeaders.Cookie) {
        finalHeaders.cookie = reqHeaders.cookie;
      }
    } catch {
      // outside a Nuxt request context — no cookies to forward
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers: finalHeaders,
    credentials: clientUsesCrossOrigin() ? "include" : "same-origin",
  };

  if (body !== undefined) {
    if (body instanceof FormData) {
      fetchOptions.body = body;
    } else {
      (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const response = await fetch(fullUrl, fetchOptions);

  if (!response.ok) {
    let data: Record<string, unknown> | null = null;
    try {
      data = await response.json();
    } catch {
      // Response body may not be JSON
    }
    throw new ApiError(response.status, data);
  }

  if (responseType === "blob") {
    return (await response.blob()) as T;
  }

  if (responseType === "text") {
    return (await response.text()) as T;
  }

  const text = await response.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
