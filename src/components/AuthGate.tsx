import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LogIn, UserPlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface AuthRequiredProps {
  action?: string; // e.g. "track patients"
}

/** Full-page inline sign-in prompt for routes that require authentication. */
export function AuthRequired({ action }: AuthRequiredProps) {
  const nav = useNavigate();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="brutal w-full max-w-sm p-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Sign in required
        </p>
        <h2 className="font-display text-2xl uppercase leading-tight mb-2">
          {action ? `To ${action}` : "Access this page"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Create a free account or sign in to continue.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => nav({ to: "/login" })}
            className="btn-brutal flex items-center justify-center gap-2 w-full"
          >
            <LogIn className="h-4 w-4" /> Sign in
          </button>
          <button
            onClick={() => nav({ to: "/login", search: { mode: "register" } })}
            className="btn-brutal flex items-center justify-center gap-2 w-full bg-secondary text-secondary-foreground"
          >
            <UserPlus className="h-4 w-4" /> Create free account
          </button>
        </div>
      </div>
    </div>
  );
}

interface AuthGateOptions {
  action?: string; // e.g. "save a form", "track a patient"
}

/** Renders the overlay gate UI + returns a `requireAuth` guard function. */
export function useAuthGate(opts: AuthGateOptions = {}) {
  const { user } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const requireAuth = (then: () => void) => {
    if (user) { then(); return; }
    setOpen(true);
  };

  const goTo = (mode: "login" | "register") => {
    setOpen(false);
    nav({ to: "/login", search: { returnTo: path, mode } });
  };

  const gate = open ? (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      {/* Sheet */}
      <div className="relative w-full max-w-md brutal bg-card p-6 mb-0 mx-0 border-t-2 border-x-2 border-border">
        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 border border-border p-1 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Sign in required
        </p>
        <h2 className="font-display text-xl uppercase leading-tight mb-1">
          {opts.action ? `To ${opts.action}` : "Continue"}
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Create a free account or sign in to save your data securely across all devices.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => goTo("login")}
            className="btn-brutal flex items-center justify-center gap-2 w-full"
          >
            <LogIn className="h-4 w-4" /> Sign in
          </button>
          <button
            onClick={() => goTo("register")}
            className="btn-brutal flex items-center justify-center gap-2 w-full bg-secondary"
          >
            <UserPlus className="h-4 w-4" /> Create free account
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Free · Works offline · Your data stays private
        </p>
      </div>
    </div>
  ) : null;

  return { gate, requireAuth };
}
