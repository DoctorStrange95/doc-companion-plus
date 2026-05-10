import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { useMemo } from "react";
import { ArrowRight, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/analytics")({ component: Analytics });

function Analytics() {
  const forms = useStore((s) => s.forms);
  const submissions = useStore((s) => s.submissions);

  const last14Days = useMemo(() => {
    const days: { date: string; visits: number }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const start = d.getTime(); const end = start + 86400000;
      days.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        visits: submissions.filter((s) => s.createdAt >= start && s.createdAt < end).length,
      });
    }
    return days;
  }, [submissions]);

  const perForm = useMemo(() => {
    return forms.map((f) => {
      const subs = submissions.filter((s) => s.formId === f.id);
      const last = subs[0]?.createdAt;
      return { form: f, count: subs.length, last };
    }).sort((a, b) => b.count - a.count);
  }, [forms, submissions]);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Per-form insights" variant="dark" />
      <PageShell>
        <div className="mb-4 grid grid-cols-3 gap-2">
          <KPI label="Forms" value={forms.length} />
          <KPI label="Responses" value={submissions.length} />
          <KPI label="Active forms" value={perForm.filter((p) => p.count > 0).length} />
        </div>

        <div className="brutal p-3">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest">Responses — last 14 days</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14Days} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={10} stroke="var(--foreground)" />
                <YAxis fontSize={10} stroke="var(--foreground)" allowDecimals={false} />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Bar dataKey="visits" fill="var(--primary)" stroke="var(--secondary)" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <h2 className="mt-6 mb-2 font-display text-2xl uppercase">Forms</h2>
        {perForm.length === 0 ? (
          <div className="brutal-flat p-8 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            No forms yet
          </div>
        ) : (
          <ul className="grid gap-3">
            {perForm.map(({ form, count, last }) => (
              <li key={form.id}>
                <Link
                  to="/analytics/$id"
                  params={{ id: form.id }}
                  className="brutal flex items-center gap-3 p-4 hover:bg-primary/30"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-border bg-primary">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-lg uppercase leading-tight">{form.name}</h3>
                      <span className="chip">{form.category}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {count} response{count === 1 ? "" : "s"}
                      {last ? ` · last ${new Date(last).toLocaleDateString("en-GB")}` : ""}
                    </p>
                  </div>
                  <div className="font-display text-3xl leading-none">{count}</div>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <div className="brutal p-3">
      <div className="font-display text-3xl leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest">{label}</div>
    </div>
  );
}
