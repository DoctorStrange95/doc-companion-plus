import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  back,
  action,
  variant = "default",
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
  variant?: "default" | "yellow" | "dark";
}) {
  const bg =
    variant === "yellow"
      ? "bg-primary text-primary-foreground"
      : variant === "dark"
        ? "bg-secondary text-secondary-foreground"
        : "bg-card";
  return (
    <header className={`sticky top-0 z-30 border-b-2 border-border ${bg}`}>
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        {back && (
          <Link
            to={back}
            className="flex h-9 w-9 items-center justify-center border-2 border-border bg-card text-foreground hover:bg-primary"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl uppercase leading-none tracking-wide">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider opacity-80">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-2xl px-4 pb-28 pt-4">{children}</main>;
}

export function SectionTitle({ children, kicker }: { children: ReactNode; kicker?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-2xl uppercase leading-none">{children}</h2>
      {kicker && <span className="chip chip-dark">{kicker}</span>}
    </div>
  );
}
