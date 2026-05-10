import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { useMemo } from "react";

export const Route = createFileRoute("/analytics")({ component: Analytics });

const COLORS = ["#FFE17C", "#171E19", "#7CFFB0", "#FF7C7C", "#7CB6FF"];

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
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [patients]);

  const last14Days = useMemo(() => {
    const days: { date: string; visits: number }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const start = d.getTime(); const end = start + 86400000;
      days.push({ date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), visits: submissions.filter((s) => s.createdAt >= start && s.createdAt < end).length });
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
      <PageHeader title="Analytics" subtitle="Population insights" variant="dark" />
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
                <XAxis dataKey="date" fontSize={10} stroke="var(--foreground)" />
                <YAxis fontSize={10} stroke="var(--foreground)" allowDecimals={false} />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Bar dataKey="visits" fill="var(--primary)" stroke="var(--secondary)" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card title="Sex distribution"><PieBlock data={sexDist} /></Card>
          <Card title="Age groups">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageBuckets} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" fontSize={10} stroke="var(--foreground)" />
                  <YAxis fontSize={10} stroke="var(--foreground)" allowDecimals={false} />
                  <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                  <Bar dataKey="value" fill="var(--success)" stroke="var(--secondary)" strokeWidth={2} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Top villages">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={villageDist} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" fontSize={10} stroke="var(--foreground)" allowDecimals={false} />
                  <YAxis dataKey="name" type="category" fontSize={10} width={70} stroke="var(--foreground)" />
                  <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                  <Bar dataKey="value" fill="var(--chart-5)" stroke="var(--secondary)" strokeWidth={2} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Form usage"><PieBlock data={formUsage} /></Card>
        </div>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="brutal p-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest">{title}</h3>
      {children}
    </div>
  );
}

function PieBlock({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0)
    return <div className="flex h-44 items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">No data</div>;
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={28} outerRadius={62} paddingAngle={2} stroke="var(--secondary)" strokeWidth={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
          <Legend wrapperStyle={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
