import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken, ApiError } from "./api";
import { store, sync } from "./store";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  best_suited_role: string;
  role: string;
  email_verified: boolean;
}

interface AuthState {
  user: AuthUser | null | undefined; // undefined = checking
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    name: string,
    phone: string,
    bestSuitedRole: string,
    proofToken?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (name: string, phone: string, bestSuitedRole: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  resendVerification: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const USER_CACHE_KEY = "communitymed_user_v1";

function cacheUser(u: AuthUser | null) {
  if (typeof window === "undefined") return;
  if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_CACHE_KEY);
}

function readCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}

function syncWorkerName(user: AuthUser) {
  const current = store.get().worker;
  if (current.name === "Health Worker" && user.name) {
    store.setWorker({ name: user.name, village: current.village });
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialise from localStorage so the app never shows "Loading…" when a
  // valid session already exists. The token is verified in the background.
  const [user, setUser] = useState<AuthUser | null | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const tok = getToken();
    if (!tok) return null;          // no token → definitely logged out
    return readCachedUser();        // cached user or null (will resolve below)
  });

  useEffect(() => {
    let mounted = true;
    const tok = getToken();
    if (!tok) { setUser(null); return; }

    // Verify the token with the server in the background.
    // We already showed the cached user instantly — this just refreshes it.
    api<AuthUser>("/api/auth/me")
      .then((u) => {
        if (!mounted) return;
        cacheUser(u);
        setUser(u);
        syncWorkerName(u);
        void sync.pull().catch(() => {});
        void sync.drain().catch(() => {});
      })
      .catch((e) => {
        if (!mounted) return;
        // Only force-logout on explicit 401 — network errors should not log the user out.
        if (e instanceof ApiError && e.status === 401) {
          setToken(null);
          cacheUser(null);
          setUser(null);
          store.clearForLogout();
        }
        // Any other error (server sleeping, 5xx): keep the cached user, stay logged in.
      });
    return () => { mounted = false; };
  }, []);

  // Keep-alive ping: hit /api/health every 10 minutes so the Render free-tier
  // backend never spins down while the app is open in a browser tab.
  useEffect(() => {
    const ping = () => fetch(`${import.meta.env.VITE_BACKEND_URL ?? ""}/api/health`).catch(() => {});
    ping(); // immediate ping on mount to wake the backend as early as possible
    const id = setInterval(ping, 10 * 60 * 1000); // every 10 minutes
    return () => clearInterval(id);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: AuthUser }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setToken(res.access_token);
    cacheUser(res.user);
    setUser(res.user);
    syncWorkerName(res.user);
    await sync.pull().catch(() => {});
    await sync.drain().catch(() => {});
  };

  const register = async (
    email: string,
    password: string,
    name: string,
    phone: string,
    bestSuitedRole: string,
    proofToken?: string,
  ) => {
    const res = await api<{ access_token: string; user: AuthUser }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password, name, phone, best_suited_role: bestSuitedRole, proof_token: proofToken ?? null }),
      },
    );
    setToken(res.access_token);
    cacheUser(res.user);
    setUser(res.user);
    syncWorkerName(res.user);
    await sync.pull().catch(() => {});
    await sync.drain().catch(() => {});
  };

  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setToken(null);
    cacheUser(null);
    setUser(null);
    store.clearForLogout();
  };

  const updateProfile = async (name: string, phone: string, bestSuitedRole: string) => {
    const updated = await api<AuthUser>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ name, phone, best_suited_role: bestSuitedRole }),
    });
    cacheUser(updated);
    setUser(updated);
    store.setWorker({ name: updated.name, village: store.get().worker.village });
  };

  const deleteAccount = async () => {
    await api("/api/auth/me", { method: "DELETE" });
    setToken(null);
    cacheUser(null);
    setUser(null);
    store.clearForLogout();
  };

  const resendVerification = async () => {
    await api("/api/auth/resend-verification", { method: "POST" });
  };

  return (
    <Ctx.Provider value={{ user, login, register, logout, updateProfile, deleteAccount, resendVerification }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
