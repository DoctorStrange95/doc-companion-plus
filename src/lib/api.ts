// Tiny API client. Uses VITE_BACKEND_URL when present, otherwise same-origin
// (the platform's ingress routes /api → backend on the same host).

const RAW = import.meta.env.VITE_BACKEND_URL ?? "";
export const API_BASE = (RAW || "").replace(/\/$/, "");

export const TOKEN_KEY = "communitymed_pro_token_v1";

export const getToken = () =>
  (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null) ?? null;

export const setToken = (t: string | null) => {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      (body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
        ? (body as { detail: unknown }).detail
        : body) ?? res.statusText;
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export const isOnline = () =>
  typeof navigator !== "undefined" ? navigator.onLine : true;
