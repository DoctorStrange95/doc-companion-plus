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
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function syncWorkerName(user: AuthUser) {
  const current = store.get().worker;
  if (current.name === "Health Worker" && user.name) {
    store.setWorker({ name: user.name, village: current.village });
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const tok = getToken();
    if (!tok) {
      setUser(null);
      return;
    }
    api<AuthUser>("/api/auth/me")
      .then((u) => {
        if (!mounted) return;
        setUser(u);
        syncWorkerName(u);
        // Pull a fresh snapshot once auth is verified.
        void sync.pull().catch(() => {});
        void sync.drain().catch(() => {});
      })
      .catch((e) => {
        if (!mounted) return;
        if (e instanceof ApiError && e.status === 401) {
          setToken(null);
        }
        setUser(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: AuthUser }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    setToken(res.access_token);
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
  ) => {
    const res = await api<{ access_token: string; user: AuthUser }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          name,
          phone,
          best_suited_role: bestSuitedRole,
        }),
      },
    );
    setToken(res.access_token);
    setUser(res.user);
    syncWorkerName(res.user);
    await sync.pull().catch(() => {});
    await sync.drain().catch(() => {});
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors */
    }
    setToken(null);
    setUser(null);
    store.clearForLogout();
  };

  return (
    <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
