import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useMemo } from "react";
import type { FormField, Submission } from "@/lib/store";

export const Route = createFileRoute("/analytics/$id")({ component: FormAnalytics });

const COLORS = ["#FFE17C", "#171E19", "#7CFFB0", "#FF7C7C", "#7CB6FF", "#C77CFF"];

function FormAnalytics() {
  const { id } = Route.useParams();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const submissions = useStore((s) =>
    s.submissions.filter((x) => x.formId === id).sort((a, b) => a.createdAt - b.createdAt),
  );

  if (!form) {
    return (
      <>
        <PageHeader title="Form analytics" back="/analytics" />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p>
        </PageShell>
      </>
    );
  }

  return (
    <>
      <PageHeader title={form.name} subtitle={`${submissions.length} responses · ${form.category}`} back="/analytics" variant="dark" />
      <PageShell>
        {submissions.length === 0 ? (
          <div className="brutal-flat p-8 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            No responses yet
          </div>
        ) : (
          <>
            <TimelineCard submissions={submissions} />
            <div className="mt-4 grid gap-4">
              {form.fields.map((field) => (
                <FieldBlock key={field.id} field={field} submissions={submissions} />
              ))}
            </div>
          </>
        )}
      </PageShell>
    </>
  );
}

function TimelineCard({ submissions }: { submissions: Submission[] }) {
  const data = useMemo(() => {
    const days: { date: string; n: number }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const start = d.getTime(); const end = start + 86400000;
      days.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        n: submissions.filter((s) => s.createdAt >= start && s.createdAt < end).length,
      });
    }
    return days;
  }, [submissions]);

  return (
    <div className="brutal p-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest">Responses — last 14 days</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" fontSize={10} stroke="var(--foreground)" />
            <YAxis fontSize={10} stroke="var(--foreground)" allowDecimals={false} />
            <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
            <Bar dataKey="n" fill="var(--primary)" stroke="var(--secondary)" strokeWidth={2} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FieldBlock({ field, submissions }: { field: FormField; submissions: Submission[] }) {
  const values = submissions.map((s) => s.data[field.id]).filter((v) => v !== undefined && v !== null && v !== "");

  if (values.length === 0) {
    return (
      <div className="brutal p-3">
        <Header field={field} answered={0} total={submissions.length} />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">No answers</p>
      </div>
    );
  }

  if (field.type === "number") {
    const nums = values.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sorted = [...nums].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // histogram (8 bins)
    const bins = 8;
    const span = max - min || 1;
    const step = span / bins;
    const hist = Array.from({ length: bins }, (_, i) => {
      const lo = min + i * step;
      const hi = i === bins - 1 ? max + 0.0001 : lo + step;
      return {
        range: `${lo.toFixed(1)}`,
        n: nums.filter((v) => v >= lo && v < hi).length,
      };
    });

    return (
      <div className="brutal p-3">
        <Header field={field} answered={nums.length} total={submissions.length} />
        <div className="mb-2 grid grid-cols-4 gap-2 text-center">
          <Stat label="Avg" value={avg.toFixed(1)} />
          <Stat label="Median" value={median.toFixed(1)} />
          <Stat label="Min" value={min.toFixed(1)} />
          <Stat label="Max" value={max.toFixed(1)} />
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" fontSize={9} stroke="var(--foreground)" />
              <YAxis fontSize={9} stroke="var(--foreground)" allowDecimals={false} />
              <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
              <Bar dataKey="n" fill="var(--primary)" stroke="var(--secondary)" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (field.type === "select" || field.type === "boolean") {
    const counts: Record<string, number> = {};
    values.forEach((v) => {
      const k = field.type === "boolean" ? (v ? "Yes" : "No") : String(v);
      counts[k] = (counts[k] ?? 0) + 1;
    });
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }));

    return (
      <div className="brutal p-3">
        <Header field={field} answered={values.length} total={submissions.length} />
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
      </div>
    );
  }

  // text / textarea / date — show recent
  return (
    <div className="brutal p-3">
      <Header field={field} answered={values.length} total={submissions.length} />
      <ul className="grid gap-1.5 max-h-56 overflow-auto">
        {values.slice(-10).reverse().map((v, i) => (
          <li key={i} className="border-2 border-border bg-card p-2 text-xs font-semibold">
            {String(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header({ field, answered, total }: { field: FormField; answered: number; total: number }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="font-display text-base uppercase leading-tight">
        {field.label}
        {field.unit ? <span className="ml-1 text-[10px] tracking-widest text-muted-foreground">({field.unit})</span> : null}
      </h3>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {answered}/{total}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-border bg-card p-1.5">
      <div className="font-display text-lg leading-none">{value}</div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
