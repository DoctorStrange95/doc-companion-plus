import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

export const Route = createFileRoute("/tools/growth")({ component: GrowthTool });

// Approximate WHO weight-for-age (boys & girls), monthly medians (kg) 0-60 mo + selected SD bands.
// Sourced from public WHO tables; values rounded for MVP reference.
const whoBoys: { m: number; SDneg2: number; median: number; SDpos2: number }[] = [
  { m: 0, SDneg2: 2.5, median: 3.3, SDpos2: 4.4 },
  { m: 6, SDneg2: 6.4, median: 7.9, SDpos2: 9.7 },
  { m: 12, SDneg2: 7.7, median: 9.6, SDpos2: 12.0 },
  { m: 18, SDneg2: 8.8, median: 10.9, SDpos2: 13.7 },
  { m: 24, SDneg2: 9.7, median: 12.2, SDpos2: 15.3 },
  { m: 30, SDneg2: 10.5, median: 13.3, SDpos2: 16.9 },
  { m: 36, SDneg2: 11.3, median: 14.3, SDpos2: 18.3 },
  { m: 42, SDneg2: 12.0, median: 15.3, SDpos2: 19.7 },
  { m: 48, SDneg2: 12.7, median: 16.3, SDpos2: 21.2 },
  { m: 54, SDneg2: 13.4, median: 17.3, SDpos2: 22.7 },
  { m: 60, SDneg2: 14.1, median: 18.3, SDpos2: 24.2 },
];
const whoGirls: typeof whoBoys = [
  { m: 0, SDneg2: 2.4, median: 3.2, SDpos2: 4.2 },
  { m: 6, SDneg2: 5.7, median: 7.3, SDpos2: 9.2 },
  { m: 12, SDneg2: 7.0, median: 8.9, SDpos2: 11.5 },
  { m: 18, SDneg2: 8.1, median: 10.2, SDpos2: 13.2 },
  { m: 24, SDneg2: 9.0, median: 11.5, SDpos2: 14.8 },
  { m: 30, SDneg2: 9.8, median: 12.7, SDpos2: 16.4 },
  { m: 36, SDneg2: 10.6, median: 13.9, SDpos2: 18.0 },
  { m: 42, SDneg2: 11.3, median: 14.9, SDpos2: 19.5 },
  { m: 48, SDneg2: 12.0, median: 15.9, SDpos2: 21.0 },
  { m: 54, SDneg2: 12.7, median: 17.0, SDpos2: 22.5 },
  { m: 60, SDneg2: 13.4, median: 18.0, SDpos2: 24.0 },
];

interface Pt { m: number; w: number }

function GrowthTool() {
  const [sex, setSex] = useState<"boys" | "girls">("boys");
  const [age, setAge] = useState(12);
  const [weight, setWeight] = useState(8);
  const [points, setPoints] = useState<Pt[]>([]);

  const ref = sex === "boys" ? whoBoys : whoGirls;

  const data = useMemo(() => {
    const map = new Map<number, { month: number; SDneg2: number; median: number; SDpos2: number; child?: number }>();
    ref.forEach((r) => map.set(r.m, { month: r.m, SDneg2: r.SDneg2, median: r.median, SDpos2: r.SDpos2 }));
    points.forEach((p) => {
      const key = p.m;
      const base = map.get(key) ?? interpolated(ref, key);
      map.set(key, { ...base, month: key, child: p.w });
    });
    return Array.from(map.values()).sort((a, b) => a.month - b.month);
  }, [ref, points]);

  // Z-score classification for current input (linear interp of SDneg2 / median / SDpos2)
  const cls = useMemo(() => {
    const i = interpolated(ref, age);
    if (weight < i.SDneg2 - (i.median - i.SDneg2) / 2) return { label: "Severely Underweight", tone: "destructive" as const };
    if (weight < i.SDneg2) return { label: "Underweight", tone: "warning" as const };
    if (weight > i.SDpos2) return { label: "Overweight", tone: "warning" as const };
    return { label: "Normal", tone: "success" as const };
  }, [ref, age, weight]);

  return (
    <>
      <PageHeader title="Growth Chart" back="/tools" variant="yellow" subtitle="WHO weight-for-age 0–60 mo" />
      <PageShell>
        <div className="brutal mb-4 grid grid-cols-2">
          {(["boys", "girls"] as const).map((s, i) => (
            <button
              key={s}
              onClick={() => setSex(s)}
              className={`px-3 py-3 text-sm font-bold uppercase tracking-wide ${
                sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"
              } ${i === 0 ? "border-r-2 border-border" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="brutal mb-4 space-y-3 p-4">
          <SectionTitle kicker="Plot">Add point</SectionTitle>
          <Row label="Age (months)"><NumInput value={age} onChange={setAge} step={1} min={0} max={60} /></Row>
          <Row label="Weight (kg)"><NumInput value={weight} onChange={setWeight} step={0.1} min={0.5} max={40} /></Row>
          <button
            onClick={() => setPoints((arr) => [...arr.filter((p) => p.m !== age), { m: age, w: weight }].sort((a, b) => a.m - b.m))}
            className="btn-brutal w-full"
          >
            Add to chart
          </button>
          {points.length > 0 && (
            <button onClick={() => setPoints([])} className="text-[11px] font-bold uppercase tracking-wider underline">
              Clear all points
            </button>
          )}
        </div>

        <div className="brutal p-3">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--foreground)" fontSize={10} label={{ value: "Months", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis stroke="var(--foreground)" fontSize={10} />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="SDneg2" stroke="var(--destructive)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="−2 SD" />
                <Line type="monotone" dataKey="median" stroke="var(--secondary)" dot={false} strokeWidth={2} name="Median" />
                <Line type="monotone" dataKey="SDpos2" stroke="var(--chart-5)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="+2 SD" />
                <Line type="monotone" dataKey="child" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, stroke: "var(--secondary)", strokeWidth: 2, fill: "var(--primary)" }} connectNulls name="Child" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`brutal-lg mt-4 p-4 ${
          cls.tone === "success" ? "bg-success" : cls.tone === "warning" ? "bg-primary" : "bg-destructive text-destructive-foreground"
        }`}>
          <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">Classification (current input)</div>
          <div className="mt-1 font-display text-3xl uppercase leading-none">{cls.label}</div>
        </div>
      </PageShell>
    </>
  );
}

function interpolated(ref: typeof whoBoys, m: number) {
  if (m <= ref[0].m) return ref[0];
  if (m >= ref[ref.length - 1].m) return ref[ref.length - 1];
  for (let i = 0; i < ref.length - 1; i++) {
    if (m >= ref[i].m && m <= ref[i + 1].m) {
      const t = (m - ref[i].m) / (ref[i + 1].m - ref[i].m);
      const lerp = (a: number, b: number) => a + (b - a) * t;
      return {
        m,
        SDneg2: lerp(ref[i].SDneg2, ref[i + 1].SDneg2),
        median: lerp(ref[i].median, ref[i + 1].median),
        SDpos2: lerp(ref[i].SDpos2, ref[i + 1].SDpos2),
      };
    }
  }
  return ref[0];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      <div className="w-32">{children}</div>
    </label>
  );
}

function NumInput({
  value, onChange, step = 1, min, max,
}: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input-brutal text-right font-mono"
    />
  );
}
