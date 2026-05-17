import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { ApiError, api, setToken } from "@/lib/api";
import { Stethoscope, ArrowRight, UserPlus, LogIn, Mail } from "lucide-react";

const searchSchema = z.object({
  returnTo: z.string().optional(),
  mode: z.enum(["login", "register"]).optional(),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (s) => searchSchema.parse(s),
});

type Mode = "login" | "register_email" | "register_otp" | "register" | "forgot";
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
  const [mode, setMode] = useState<Mode>(initialMode === "register" ? "register_email" : "login");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [proofToken, setProofToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bestSuitedRole, setBestSuitedRole] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get("access_token");
      if (token) {
        setToken(token);
        window.history.replaceState(null, "", "/login");
        window.location.replace("/");
      }
    }
  }, []);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) { setError("Enter your email address."); return; }
    setBusy(true);
    try {
      await api("/api/auth/send-register-otp", {
        method: "POST",
        body: JSON.stringify({ email: trimmedEmail }),
      });
      setMode("register_otp");
      setTimeout(() => otpRef.current?.focus(), 100);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code from your email."); return; }
    setBusy(true);
    try {
      const res = await api<{ proof_token: string }>("/api/auth/verify-register-otp", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      });
      setProofToken(res.proof_token);
      setMode("register");
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setForgotSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.detail) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          proofToken || undefined,
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="brutal-lg mb-6 flex items-center gap-3 bg-primary p-5">
            <Stethoscope className="h-9 w-9" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest">
                ResearchMed
              </div>
              <div className="font-display text-2xl uppercase leading-none">
                {mode === "login" ? "Sign in"
                  : mode === "register_email" ? "Create account"
                  : mode === "register_otp" ? "Verify email"
                  : mode === "register" ? "Complete sign-up"
                  : "Reset password"}
              </div>
            </div>
          </div>

          {/* Step 1: enter email, send OTP */}
          {mode === "register_email" && (
            <form onSubmit={sendOtp} className="brutal space-y-3 p-5">
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="input-brutal"
                  autoComplete="email"
                  placeholder="your@email.com"
                />
              </Field>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                We'll send a 6-digit code to verify this address.
              </p>
              {error && (
                <p className="border-2 border-destructive bg-destructive/10 p-2 text-xs font-bold uppercase tracking-wider text-destructive">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="btn-brutal flex w-full items-center justify-center gap-2 disabled:opacity-50">
                <Mail className="h-4 w-4" />
                {busy ? "Sending…" : "Send verification code"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* Step 2: enter OTP */}
          {mode === "register_otp" && (
            <form onSubmit={verifyOtp} className="brutal space-y-3 p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Code sent to <span className="text-foreground">{email}</span>
              </p>
              <Field label="6-digit code">
                <input
                  ref={otpRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  required
                  className="input-brutal text-center text-2xl font-bold tracking-[0.3em]"
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </Field>
              {error && (
                <p className="border-2 border-destructive bg-destructive/10 p-2 text-xs font-bold uppercase tracking-wider text-destructive">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="btn-brutal flex w-full items-center justify-center gap-2 disabled:opacity-50">
                {busy ? "Verifying…" : "Verify & continue"}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setMode("register_email"); setOtp(""); setError(""); }}
                className="w-full text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground underline"
              >
                Wrong email? Go back
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <div className="brutal space-y-3 p-5">
              {forgotSent ? (
                <div className="border-2 border-primary bg-primary/10 p-4 text-center">
                  <p className="text-sm font-bold uppercase tracking-widest">Check your email</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A password reset link has been sent to <strong>{email}</strong>
                  </p>
                </div>
              ) : (
                <form onSubmit={submitForgot} className="space-y-3">
                  <Field label="Email">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="input-brutal"
                      autoComplete="email"
                      placeholder="your@email.com"
                    />
                  </Field>
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
                    {busy ? "Sending…" : "Send reset link"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}
            </div>
          )}

          <form onSubmit={submit} className="brutal space-y-3 p-5" data-testid="auth-form" style={{ display: (mode === "forgot" || mode === "register_email" || mode === "register_otp") ? "none" : undefined }}>
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
                <div>
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Email <span className="text-green-700 text-[9px]">✓ Verified</span></span>
                  <div className="input-brutal bg-muted/30 text-muted-foreground select-none cursor-not-allowed">{email}</div>
                </div>
                <Field label="Phone Number *">
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
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); }}
                  className="text-left text-[10px] font-bold uppercase tracking-widest underline text-muted-foreground"
                >
                  Forgot password?
                </button>
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
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Complete sign-up"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <button
            type="button"
            data-testid="auth-mode-toggle"
            style={{ display: mode === "register_otp" ? "none" : undefined }}
            onClick={() => {
              setError("");
              setForgotSent(false);
              if (mode === "login" || mode === "forgot") {
                setMode("register_email");
                setEmail(""); setOtp(""); setProofToken(""); setName(""); setPhone(""); setBestSuitedRole(""); setConfirmPassword("");
              } else {
                setMode("login");
              }
            }}
            className="mt-4 w-full text-center text-[11px] font-bold uppercase tracking-widest underline"
          >
            {mode === "login" || mode === "forgot"
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
