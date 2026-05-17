import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MailCheck, X } from "lucide-react";

import appCss from "../styles.css?url";
import { BottomNav } from "@/components/BottomNav";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

function SyncIndicator() {
  const active = useStore((s) => s.syncing || s.pulling);
  if (!active) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 overflow-hidden bg-secondary/20 print:hidden">
      <div className="sync-bar-inner h-full w-1/3 bg-secondary" />
    </div>
  );
}

function EmailVerificationBanner() {
  const { user, resendVerification } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.email_verified || dismissed) return null;

  const handleResend = async () => {
    setSending(true);
    try {
      await resendVerification();
      setSent(true);
    } catch {
      // ignore, user can try again
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b-2 border-amber-400 bg-amber-50 px-4 py-2.5 print:hidden">
      <MailCheck className="h-4 w-4 shrink-0 text-amber-700" />
      <p className="flex-1 text-[11px] font-bold uppercase tracking-widest text-amber-800">
        {sent
          ? "Verification email sent — check your inbox"
          : "Verify your email to secure your account"}
      </p>
      {!sent && (
        <button
          onClick={handleResend}
          disabled={sending}
          className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-amber-900 underline disabled:opacity-50"
        >
          {sending ? "Sending…" : "Resend"}
        </button>
      )}
      <button onClick={() => setDismissed(true)} className="shrink-0 text-amber-700 hover:text-amber-900">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg w-full text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {error?.message && (
          <div className="mt-4 rounded border-2 border-destructive bg-destructive/10 p-3 text-left">
            <p className="text-xs font-bold uppercase tracking-wider text-destructive mb-1">Error</p>
            <p className="text-xs font-mono text-destructive break-all">{error.message}</p>
            {error.stack && (
              <details className="mt-2">
                <summary className="text-xs font-bold uppercase tracking-wider text-destructive cursor-pointer">Stack trace</summary>
                <pre className="mt-1 text-[10px] font-mono text-destructive whitespace-pre-wrap break-all">{error.stack}</pre>
              </details>
            )}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ResearchMed" },
      { name: "description", content: "Longitudinal community health records, form builder, and analytics for frontline health workers." },
      { name: "author", content: "ResearchMed" },
      { property: "og:title", content: "ResearchMed" },
      { property: "og:description", content: "Longitudinal community health records and analytics for frontline health workers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // In SSR (Cloudflare Workers) mode this renders the full HTML document.
  // In SPA mode (Vercel) index.html provides the shell and this renders the body content.
  if (typeof document !== "undefined") {
    // Client-side / SPA: skip the html/head/body wrapper
    return <>{children}</>;
  }
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthShell />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthShell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (user === undefined) return;
    if (user && path === "/login") {
      nav({ to: "/", replace: true });
    }
  }, [user, path, nav]);

  const isPublic = path.startsWith("/f/") || path.startsWith("/fa/") || path.startsWith("/pg/");
  const isLoginPage = path === "/login";

  // Show loading only while the auth state is genuinely unknown (SSR or
  // edge case where localStorage is unavailable). Once we have a user from
  // cache or know they're logged out, render immediately with cached data.
  // The (user && !initDone) gate was removed — it caused 15-second loading
  // screens for users whose first pull failed (cold backend on login).
  if ((!isPublic && !isLoginPage) && user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-display text-2xl uppercase tracking-widest text-muted-foreground">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {!isPublic && !isLoginPage && <SyncIndicator />}
      {!isPublic && !isLoginPage && <EmailVerificationBanner />}
      <Outlet />
      {!isPublic && !isLoginPage && <BottomNav />}
    </div>
  );
}
