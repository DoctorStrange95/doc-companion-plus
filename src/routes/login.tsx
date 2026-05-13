import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { API_BASE, ApiError, api, setToken } from "@/lib/api";
import { Stethoscope, ArrowRight, UserPlus, LogIn, Chrome } from "lucide-react";

const searchSchema = z.object({
  returnTo: z.string().optional(),
  mode: z.enum(["login", "register"]).optional(),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (s) => searchSchema.parse(s),
});

type Mode = "login" | "register";
type GoogleStatus = "checking" | "enabled" | "not-configured" | "unavailable";
const BEST_SUITED_ROLES = [
  "Nurse",
  "Doctor",
  "Researcher",
  "Student",
  "Community Worker",
] as const;

function LoginPage() {
  const { login, register } = useAuth();
  const { returnTo, mode: initialMode } = Route.useSearch();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bestSuitedRole, setBestSuitedRole] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>("checking");

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get("access_token");
      if (token) {
        setToken(token);
        window.history.replaceState(null, "", "/login");
        window.location.replace("/");
        return;
      }
    }

    let mounted = true;
    api<{ enabled: boolean }>("/api/auth/google/config")
      .then((config) => {
        if (mounted) setGoogleStatus(config.enabled ? "enabled" : "not-configured");
      })
      .catch(() => {
        if (mounted) setGoogleStatus("unavailable");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register(
          email.trim().toLowerCase(),
          password,
          name.trim(),
          phone.trim(),
          bestSuitedRole.trim(),
        );
      }
      nav({ to: returnTo ?? "/", replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "string"
            ? e.detail
            : Array.isArray(e.detail)
              ? e.detail
                  .map((d: unknown) =>
                    d && typeof d === "object" && "msg" in d
                      ? String((d as { msg: string }).msg)
                      : String(d),
                  )
                  .join(", ")
              : "Something went wrong"
          : (e as Error).message;
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const startGoogleLogin = () => {
    setError("");
    if (googleStatus === "not-configured") {
      setError(
        "Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the backend.",
      );
      return;
    }
    if (googleStatus === "checking") return;
    const returnTo = typeof window !== "undefined" ? window.location.origin : "/";
    window.location.href = `${API_BASE}/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="brutal-lg mb-6 flex items-center gap-3 bg-primary p-5">
            <Stethoscope className="h-9 w-9" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest">
                CommunityMed Pro
              </div>
              <div className="font-display text-2xl uppercase leading-none">
                {mode === "login" ? "Sign in" : "Create account"}
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="brutal space-y-3 p-5" data-testid="auth-form">
            <button
              type="button"
              data-testid="google-auth-submit"
              onClick={startGoogleLogin}
              disabled={googleStatus === "checking"}
              className="btn-brutal flex w-full items-center justify-center gap-2 bg-white text-foreground disabled:opacity-50"
            >
              <Chrome className="h-4 w-4" />
              {googleStatus === "checking" ? "Checking Google…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3">
              <div className="h-0.5 flex-1 bg-border" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                or
              </span>
              <div className="h-0.5 flex-1 bg-border" />
            </div>

            {mode === "register" && (
              <>
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Asha CHW"
                    data-testid="auth-name"
                    className="input-brutal"
                    autoComplete="name"
                    required
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="auth-email"
                    className="input-brutal"
                    autoComplete="email"
                  />
                </Field>
                <Field label="Phone Number">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    data-testid="auth-phone"
                    className="input-brutal"
                    autoComplete="tel"
                    required
                  />
                </Field>
                <Field label="Best Suited Role">
                  <select
                    value={bestSuitedRole}
                    onChange={(e) => setBestSuitedRole(e.target.value)}
                    data-testid="auth-best-suited-role"
                    className="input-brutal"
                    required
                  >
                    <option value="">Select role</option>
                    {BEST_SUITED_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    data-testid="auth-password"
                    className="input-brutal"
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm Password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="auth-confirm-password"
                    className="input-brutal"
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                </Field>
              </>
            )}
            {mode === "login" && (
              <>
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="auth-email"
                    className="input-brutal"
                    autoComplete="email"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    data-testid="auth-password"
                    className="input-brutal"
                    autoComplete="current-password"
                  />
                </Field>
              </>
            )}
            <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                data-testid="auth-show-password"
              />
              View password
            </label>

            {error && (
              <p
                data-testid="auth-error"
                className="border-2 border-destructive bg-destructive/10 p-2 text-xs font-bold uppercase tracking-wider text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              data-testid="auth-submit"
              className="btn-brutal flex w-full items-center justify-center gap-2 disabled:opacity-50"
            >
              {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <button
            type="button"
            data-testid="auth-mode-toggle"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              if (mode === "register") {
                setName("");
                setPhone("");
                setBestSuitedRole("");
                setConfirmPassword("");
              }
            }}
            className="mt-4 w-full text-center text-[11px] font-bold uppercase tracking-widest underline"
          >
            {mode === "login"
              ? "No account? Create one"
              : "Already registered? Sign in"}
          </button>

          <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Data syncs to your account when online · works offline too
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
