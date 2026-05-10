import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageShell } from "@/components/PageShell";
import { Activity, Users, FilePlus2, ClipboardList, BarChart3, ArrowRight, Stethoscope } from "lucide-react";

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
      <header className="bg-gradient-to-br from-primary to-primary/70 px-4 pb-8 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-2 text-xs opacity-90">
            <Stethoscope className="h-4 w-4" />
            CommunityMed Pro
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight">
            Hello, {worker.name.split(" ")[0]}
          </h1>
          <p className="text-sm opacity-90">{worker.village} · {today.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Patients" value={activePatients} icon={Users} />
            <Stat label="Visits today" value={todayCount} icon={Activity} />
            <Stat label="Forms" value={forms.length} icon={ClipboardList} />
          </div>
        </div>
      </header>

      <PageShell>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction to="/patients/new" icon={Users} label="Register patient" tone="primary" />
          <QuickAction to="/patients" icon={ClipboardList} label="Find patient" />
          <QuickAction to="/forms" icon={FilePlus2} label="Form library" />
          <QuickAction to="/analytics" icon={BarChart3} label="Analytics" />
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent visits</h2>
        {submissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No visits recorded yet. Register a patient to begin.
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {submissions.slice(0, 6).map((s) => {
              const p = patients.find((x) => x.id === s.patientId);
              return (
                <li key={s.id}>
                  <Link
                    to="/patients/$id"
                    params={{ id: s.patientId }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p?.name ?? "Unknown"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.formName} · {new Date(s.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PageShell>
    </>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <div className="rounded-xl bg-white/15 p-3 backdrop-blur">
      <Icon className="h-4 w-4 opacity-80" />
      <div className="mt-1 text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] opacity-90">{label}</div>
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
      className={`flex items-center gap-3 rounded-xl border p-4 transition-colors ${
        tone === "primary"
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-card hover:bg-muted/50"
      }`}
    >
      <Icon className="h-5 w-5" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}
