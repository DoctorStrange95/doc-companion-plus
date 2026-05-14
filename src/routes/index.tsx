import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageShell, SectionTitle } from "@/components/PageShell";
import {
  Users, FilePlus2, ClipboardList, BarChart3, ArrowRight, Stethoscope,
  Wrench, Activity, TrendingUp,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const forms = useStore((s) => s.forms);
  const worker = useStore((s) => s.worker);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = submissions.filter((s) => s.createdAt >= today.getTime()).length;
  const activePatients = patients.filter((p) => p.status === "Active").length;

  return (
    <>
      <header className="border-b-2 border-border bg-primary px-4 pb-6 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-2xl">
          <div className="inline-flex items-center gap-1.5 border-2 border-border bg-card px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
            <Stethoscope className="h-3 w-3" />
            CommunityMed Pro
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
          <SectionTitle kicker={`${submissions.length}`}>Recent activity</SectionTitle>
          {submissions.length === 0 ? (
            <div className="brutal-flat p-6 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              No activity yet.
            </div>
          ) : (
            <ul className="brutal divide-y-2 divide-border">
              {[...submissions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((s) => {
                const p = s.patientId ? patients.find((x) => x.id === s.patientId) : null;
                const label = p?.name ?? (s.patientId ? "Unknown patient" : s.formName);
                const sub = p ? `${s.formName} · ${new Date(s.createdAt).toLocaleString()}` : new Date(s.createdAt).toLocaleString();
                return (
                  <li key={s.id}>
                    {p ? (
                      <Link
                        to="/patients/$id"
                        params={{ id: s.patientId }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-primary/30"
                      >
                        <div className="flex h-9 w-9 items-center justify-center border-2 border-border bg-primary">
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">{label}</div>
                          <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{sub}</div>
                        </div>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-9 w-9 items-center justify-center border-2 border-border bg-card">
                          <ClipboardList className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">{label}</div>
                          <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{sub}</div>
                        </div>
                      </div>
                    )}
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
