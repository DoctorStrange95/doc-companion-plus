import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { useMemo } from "react";

export const Route = createFileRoute("/analytics")({ component: Analytics });

const COLORS = ["#0ea5a5", "#22c55e", "#f59e0b", "#ef4444", "#6366f1", "#a855f7"];

function Analytics() {
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const forms = useStore((s) => s.forms);

  const sexDist = useMemo(() => {
    const m: Record<string, number> = {};
    patients.forEach((p) => (m[p.sex] = (m[p.sex] ?? 0) + 1));
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [patients]);

  const villageDist = useMemo(() => {
    const m: Record<string, number> = {};
    patients.forEach((p) => (m[p.village] = (m[p.village] ?? 0) + 1));
    return Object.entries(m)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [patients]);

  const last14Days = useMemo(() => {
    const days: { date: string; visits: number }[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const start = d.getTime();
      const end = start + 86400000;
      const visits = submissions.filter((s) => s.createdAt >= start && s.createdAt < end).length;
      days.push({ date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), visits });
    }
    return days;
  }, [submissions]);

  const formUsage = useMemo(() => {
    const m: Record<string, number> = {};
    submissions.forEach((s) => (m[s.formName] = (m[s.formName] ?? 0) + 1));
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [submissions]);

  const ageBuckets = useMemo(() => {
    const buckets = { "<5y": 0, "5-17y": 0, "18-39y": 0, "40-59y": 0, "60+y": 0 };
    patients.forEach((p) => {
      const dob = new Date(p.dob);
      const age = (Date.now() - dob.getTime()) / (365.25 * 86400000);
      if (age < 5) buckets["<5y"]++;
      else if (age < 18) buckets["5-17y"]++;
      else if (age < 40) buckets["18-39y"]++;
      else if (age < 60) buckets["40-59y"]++;
      else buckets["60+y"]++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [patients]);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Population insights" />
      <PageShell>
        <div className="mb-4 grid grid-cols-3 gap-2">
          <KPI label="Patients" value={patients.length} />
          <KPI label="Visits" value={submissions.length} />
          <KPI label="Forms" value={forms.length} />
        </div>

        <Card title="Visits — last 14 days">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14Days} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={10} stroke="var(--muted-foreground)" />
                <YAxis fontSize={10} stroke="var(--muted-foreground)" allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="visits" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card title="Sex distribution">
            <PieBlock data={sexDist} />
          </Card>
          <Card title="Age groups">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageBuckets} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" fontSize={10} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={10} stroke="var(--muted-foreground)" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Top villages">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={villageDist} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" fontSize={10} stroke="var(--muted-foreground)" allowDecimals={false} />
                  <YAxis dataKey="name" type="category" fontSize={10} width={70} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Form usage">
            <PieBlock data={formUsage} />
          </Card>
        </div>
      </PageShell>
    </>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function PieBlock({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0)
    return <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">No data</div>;
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={30} outerRadius={60} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
