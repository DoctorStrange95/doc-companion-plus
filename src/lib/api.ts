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
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (lower.includes("load failed") || lower.includes("failed to fetch") || lower.includes("network request failed")) {
      throw new Error("Cannot reach server. Check your internet connection or try again.");
    }
    throw new Error(msg);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    let detail =
      (body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
        ? (body as { detail: unknown }).detail
        : body) ?? res.statusText;
    if (
      res.status >= 500 &&
      typeof detail === "string" &&
      detail.toLowerCase().includes("internal server error") &&
      path.startsWith("/api/auth")
    ) {
      detail =
        "Auth backend is not running or is missing DATABASE_URL. Start the FastAPI backend on port 8001 with Supabase config.";
    }
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export const isOnline = () =>
  typeof navigator !== "undefined" ? navigator.onLine : true;
