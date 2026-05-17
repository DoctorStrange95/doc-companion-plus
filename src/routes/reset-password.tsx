import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ApiError, api } from "@/lib/api";
import { Stethoscope, ArrowRight } from "lucide-react";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  validateSearch: (s) => searchSchema.parse(s),
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => nav({ to: "/login", replace: true }), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : (e as Error).message);
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
              <div className="text-[10px] font-bold uppercase tracking-widest">ResearchMed</div>
              <div className="font-display text-2xl uppercase leading-none">New password</div>
            </div>
          </div>

          {!token ? (
            <div className="brutal p-5">
              <p className="text-sm font-bold text-destructive uppercase tracking-widest">
                Invalid or missing reset token. Please request a new reset link.
              </p>
            </div>
          ) : done ? (
            <div className="brutal p-5 text-center">
              <p className="text-sm font-bold uppercase tracking-widest">Password updated!</p>
              <p className="mt-1 text-xs text-muted-foreground">Redirecting to sign in…</p>
            </div>
          ) : (
            <form onSubmit={submit} className="brutal space-y-3 p-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">New password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-brutal"
                  autoComplete="new-password"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Confirm password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-brutal"
                  autoComplete="new-password"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                View password
              </label>
              {error && (
                <p className="border-2 border-destructive bg-destructive/10 p-2 text-xs font-bold uppercase tracking-wider text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="btn-brutal flex w-full items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Set new password"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
