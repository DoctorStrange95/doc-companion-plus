import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { PageShell, SectionTitle } from "@/components/PageShell";
import {
  Users, FilePlus2, ClipboardList, BarChart3, ArrowRight, Stethoscope,
  Wrench, Activity, TrendingUp,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user } = useAuth();
  const allPatients = useStore((s) => s.patients);
  const allSubmissions = useStore((s) => s.submissions);
  const allLongitudinalSubmissions = useStore((s) => s.longitudinalSubmissions);
  const forms = useStore((s) => s.forms);
  const worker = useStore((s) => s.worker);

  // Hide personal data from logged-out visitors
  const patients = user ? allPatients : [];
  const submissions = user ? allSubmissions : [];
  const longitudinalSubmissions = user ? allLongitudinalSubmissions : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = submissions.filter((s) => s.createdAt >= today.getTime()).length;
  const activePatients = patients.filter((p) => p.status === "Active").length;

  // Group all activity by form — one card per form, most recent first
  const recentActivity = useMemo(() => {
    type ActivityEntry = { formId: string; formName: string; count: number; lastAt: number; isLongitudinal: boolean };
    const map = new Map<string, ActivityEntry>();

    for (const s of submissions) {
      const e = map.get(s.formId);
      if (e) {
        e.count++;
        if (s.createdAt > e.lastAt) e.lastAt = s.createdAt;
      } else {
        map.set(s.formId, { formId: s.formId, formName: s.formName || "Untitled form", count: 1, lastAt: s.createdAt, isLongitudinal: false });
      }
    }

    for (const ls of longitudinalSubmissions) {
      const form = forms.find((f) => f.id === ls.formId);
      const lastVisitTs = ls.visits.length > 0
        ? new Date(ls.visits[ls.visits.length - 1].timestamp).getTime()
        : 0;
      const e = map.get(ls.formId);
      if (e) {
        e.count += ls.visits.length;
        if (lastVisitTs > e.lastAt) e.lastAt = lastVisitTs;
      } else {
        map.set(ls.formId, { formId: ls.formId, formName: form?.name ?? "Longitudinal form", count: ls.visits.length, lastAt: lastVisitTs, isLongitudinal: true });
      }
    }

    const sorted = [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
    const todayItems = sorted.filter((e) => e.lastAt >= today.getTime());
    // Show today's activity (up to 5); if nothing today, show max 3 most recent
    return todayItems.length > 0 ? todayItems.slice(0, 5) : sorted.slice(0, 3);
  }, [submissions, longitudinalSubmissions, forms]);

  return (
    <>
      <header className="border-b-2 border-border bg-primary px-4 pb-6 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-2xl">
          <div className="inline-flex items-center gap-1.5 border-2 border-border bg-card px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
            <Stethoscope className="h-3 w-3" />
            ResearchMed
          </div>
          <h1 className="mt-3 font-display text-5xl uppercase leading-[0.9]">
            Hello,<br />
            {worker.name.split(" ")[0]}.
          </h1>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider">
            {worker.village} · {today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Patients" value={activePatients} icon={Users} />
            <Stat label="Visits today" value={todayCount} icon={Activity} />
            <Stat label="Forms" value={forms.length} icon={ClipboardList} />
          </div>
        </div>
      </header>

      <PageShell>
        <SectionTitle kicker="Quick">Actions</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction to="/tools/growth" icon={TrendingUp} label="Growth chart" tone="primary" />
          <QuickAction to="/tools/growth" icon={Users} label="Tracked patients" />
          <QuickAction to="/forms" icon={FilePlus2} label="Form library" />
          <QuickAction to="/tools" icon={Wrench} label="Clinical tools" />
        </div>

        <div className="mt-8">
          <SectionTitle kicker={`${submissions.length + longitudinalSubmissions.reduce((n, ls) => n + ls.visits.length, 0)}`}>Recent activity</SectionTitle>
          {recentActivity.length === 0 ? (
            <div className="brutal-flat p-6 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              No activity yet.
            </div>
          ) : (
            <ul className="brutal divide-y-2 divide-border">
              {recentActivity.map((entry) => {
                const todayResponses = submissions.filter(
                  (s) => s.formId === entry.formId && s.createdAt >= today.getTime()
                ).length;
                const relativeDate = (() => {
                  const d = new Date(entry.lastAt);
                  const diffMs = Date.now() - entry.lastAt;
                  const diffDays = Math.floor(diffMs / 86400000);
                  if (diffDays === 0) return `Today · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                  if (diffDays === 1) return "Yesterday";
                  if (diffDays < 7) return `${diffDays}d ago`;
                  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                })();
                return (
                  <li key={entry.formId}>
                    <Link
                      to="/forms/$id"
                      params={{ id: entry.formId }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-primary/30"
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 border-border ${entry.isLongitudinal ? "bg-primary" : "bg-card"}`}>
                        {entry.isLongitudinal ? <TrendingUp className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{entry.formName}</div>
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <span>{entry.count} response{entry.count !== 1 ? "s" : ""}</span>
                          {todayResponses > 0 && (
                            <span className="border border-primary bg-primary/20 px-1 py-0.5 text-[9px] font-black tracking-widest text-primary">
                              +{todayResponses} today
                            </span>
                          )}
                          <span>· {relativeDate}</span>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-8">
          <SectionTitle kicker="Insights">Analytics</SectionTitle>
          <Link to="/analytics" className="brutal flex items-center justify-between p-4 hover:bg-primary">
            <div>
              <div className="font-display text-2xl uppercase leading-none">Open dashboard</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Visits, sex, age groups, top villages
              </div>
            </div>
            <BarChart3 className="h-7 w-7" />
          </Link>
        </div>
      </PageShell>
    </>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <div className="border-2 border-border bg-card p-3 text-foreground">
      <Icon className="h-4 w-4" />
      <div className="mt-1 font-display text-3xl leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest">{label}</div>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  tone,
}: {
  to: string;
  icon: typeof Users;
  label: string;
  tone?: "primary";
}) {
  return (
    <Link
      to={to}
      className={`brutal-sm flex items-center gap-3 p-4 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 ${
        tone === "primary" ? "bg-primary" : "bg-card hover:bg-primary/40"
      }`}
    >
      <Icon className="h-5 w-5" strokeWidth={2.4} />
      <span className="text-sm font-bold uppercase tracking-wide">{label}</span>
    </Link>
  );
}
