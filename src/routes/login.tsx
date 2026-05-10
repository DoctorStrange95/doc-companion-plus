import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Stethoscope, ArrowRight, UserPlus, LogIn } from "lucide-react";

export const Route = createFileRoute("/login")({ component: LoginPage });

type Mode = "login" | "register";

function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register(email.trim().toLowerCase(), password, name.trim());
      }
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
            {mode === "register" && (
              <Field label="Your name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Asha CHW"
                  data-testid="auth-name"
                  className="input-brutal"
                  autoComplete="name"
                />
              </Field>
            )}
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                data-testid="auth-password"
                className="input-brutal"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>

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
