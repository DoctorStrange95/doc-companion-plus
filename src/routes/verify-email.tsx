import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
  validateSearch: (s) => searchSchema.parse(s),
});

function VerifyEmail() {
  const { token } = Route.useSearch();
  const nav = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    api<{ ok: boolean }>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => {
        setStatus("success");
        setTimeout(() => nav({ to: "/", replace: true }), 2500);
      })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="brutal max-w-sm w-full p-8 text-center">
        {status === "checking" && (
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Verifying…
          </p>
        )}
        {status === "success" && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Email verified!</p>
            <p className="mt-2 text-xs text-muted-foreground">Redirecting you to the app…</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-destructive">
              Link invalid or already used
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Your email may already be verified.{" "}
              {user ? (
                <button onClick={() => nav({ to: "/", replace: true })} className="underline">
                  Go to app
                </button>
              ) : (
                <a href="/login" className="underline">Sign in</a>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
