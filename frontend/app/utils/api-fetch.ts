export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;

  constructor(status: number, data: Record<string, unknown> | null) {
    const message = (data?.message as string) ?? (data?.statusMessage as string) ?? `Request failed with status ${status}`;
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

export async function apiFetch<T = unknown>(url: string, options: ApiFetchOptions = {}): Promise<T> {
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

  const fetchOptions: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };

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

  // Handle empty responses (204 No Content, etc.)
  const text = await response.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
