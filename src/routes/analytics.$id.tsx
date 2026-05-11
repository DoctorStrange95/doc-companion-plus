import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { useMemo, useState } from "react";
import type { FormField, Submission } from "@/lib/store";
import {
  computeNumericStats, computeCategoricalStats, computeYesNoStats,
  computeRatingStats, buildTimeSeries, selectChartType,
  type NumericStats, type FrequencyRow,
} from "@/lib/analytics";
import { Download, List } from "lucide-react";
import { getFormColor } from "@/lib/formColor";

export const Route = createFileRoute("/analytics/$id")({ component: FormAnalytics });

const COLORS = ["#FFE17C", "#7CFFB0", "#FF7C7C", "#7CB6FF", "#C77CFF", "#171E19"];

type DateRange = "all" | "7d" | "30d";

function filterByDate(subs: Submission[], range: DateRange): Submission[] {
  if (range === "all") return subs;
  const now = Date.now();
  const cutoff = range === "7d" ? now - 7 * 86400000 : now - 30 * 86400000;
  return subs.filter((s) => s.createdAt >= cutoff);
}

function exportCsv(form: { name: string; fields: FormField[] }, subs: Submission[]) {
  const dataFields = form.fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");
  const headers = ["#", "Date", "Time", "Respondent Email", ...dataFields.map((f) => f.variableName ?? f.label)];
  const rows = subs.map((s, i) => {
    const dt = new Date(s.createdAt);
    const date = dt.toLocaleDateString("en-GB");
    const time = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const email = (s.data["__respondent_email"] as string | undefined) ?? "";
    const vals = dataFields.map((f) => {
      const v = s.data[f.id];
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return `"${v.join("; ")}"`;
      if (typeof v === "object") return `"${JSON.stringify(v)}"`;
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    return [String(i + 1), date, time, `"${email.replace(/"/g, '""')}"`, ...vals].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${form.name.replace(/[^a-z0-9]/gi, "_")}_analytics.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FormAnalytics() {
  const { id } = Route.useParams();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const rawSubs = useStore((s) => s.submissions);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const formColor = getFormColor(id);

  const allSubs = useMemo(
    () => rawSubs.filter((x) => x.formId === id).sort((a, b) => a.createdAt - b.createdAt),
    [rawSubs, id],
  );
  const submissions = useMemo(() => filterByDate(allSubs, dateRange), [allSubs, dateRange]);

  if (!form) {
    return (
      <>
        <PageHeader title="Analytics" back="/analytics" />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p>
        </PageShell>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={form.name}
        subtitle={`${submissions.length} response${submissions.length !== 1 ? "s" : ""} · ${form.category}`}
        back="/analytics"
        variant="dark"
        action={
          <div className="flex items-center gap-1.5">
            <Link
              to="/forms/$id/responses"
              params={{ id: form.id }}
              className="border-2 border-border bg-card p-1.5 hover:bg-muted"
              title="View responses"
            >
              <List className="h-4 w-4" />
            </Link>
            {submissions.length > 0 && (
              <button
                onClick={() => exportCsv(form, submissions)}
                className="border-2 border-border bg-card p-1.5 hover:bg-muted"
                title="Export CSV"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
          </div>
        }
      />
      <PageShell>
        {/* Date range filter */}
        <div className="mb-4 flex gap-1.5">
          {(["all", "7d", "30d"] as DateRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${dateRange === r ? "bg-primary" : "hover:bg-muted"}`}
            >
              {r === "all" ? "All time" : r === "7d" ? "7 days" : "30 days"}
            </button>
          ))}
        </div>

        {submissions.length === 0 ? (
          <div className="brutal-flat p-8 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            No responses in this period
          </div>
        ) : (
          <>
            <TimelineCard submissions={submissions} color={formColor} />
            <div className="mt-4 grid gap-4">
              {form.fields
                .filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "photo" && f.type !== "location")
                .map((field) => (
                  <FieldBlock key={field.id} field={field} submissions={submissions} isLongitudinal={!!form.longitudinal} color={formColor} />
                ))}
            </div>
          </>
        )}
      </PageShell>
    </>
  );
}

function TimelineCard({ submissions, color }: { submissions: Submission[]; color: string }) {
  const data = useMemo(() => {
    const days: { date: string; n: number }[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const start = d.getTime();
      const end = start + 86400000;
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
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" fontSize={9} stroke="var(--foreground)" />
            <YAxis fontSize={9} stroke="var(--foreground)" allowDecimals={false} />
            <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
            <Bar dataKey="n" fill={color} stroke="var(--border)" strokeWidth={2} name="Responses" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FieldHeader({ field, answered, total }: { field: FormField; answered: number; total: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="font-display text-base uppercase leading-tight">
        {field.label}
        {field.unit ? <span className="ml-1 text-[10px] tracking-widest text-muted-foreground">({field.unit})</span> : null}
      </h3>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
        n = {answered}/{total}
      </span>
    </div>
  );
}

function NumericStatsTable({ stats }: { stats: NumericStats }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-1.5">
      <StatCell label="Mean ± SD" value={`${stats.mean} ± ${stats.sd}`} />
      <StatCell label="Median" value={String(stats.median)} />
      <StatCell label="Range" value={`${stats.min}–${stats.max}`} />
      <StatCell label="IQR" value={`${stats.p25}–${stats.p75}`} hint="25th–75th percentile" />
      <StatCell label="95% CI" value={`${stats.ci95Lower}–${stats.ci95Upper}`} hint="95% Confidence Interval of mean" />
      <StatCell label="SE" value={String(stats.se)} hint="Standard Error" />
    </div>
  );
}

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-2 border-border bg-card p-1.5 text-center" title={hint}>
      <div className="font-display text-sm leading-tight">{value}</div>
      <div className="mt-0.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function FrequencyTable({ rows }: { rows: FrequencyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3 overflow-hidden border-2 border-border">
      {rows.map((r) => (
        <div key={String(r.value)} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-0">
          <div className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wider truncate">{r.label}</div>
          <div className="text-[11px] font-bold tabular-nums">{r.count}</div>
          <div className="w-12 text-right text-[10px] text-muted-foreground">{r.percent}%</div>
          <div className="w-16 h-2 bg-muted border border-border overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${r.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldBlock({ field, submissions, isLongitudinal, color }: { field: FormField; submissions: Submission[]; isLongitudinal: boolean; color: string }) {
  const raw = submissions.map((s) => s.data[field.id]);
  const nonEmpty = raw.filter((v) => v !== undefined && v !== null && v !== "");

  const opts = field.optionObjects && field.optionObjects.length > 0
    ? field.optionObjects
    : (field.options ?? []).map((o) => ({ label: o, value: o }));

  const chartType = selectChartType(field.type, opts.length, isLongitudinal);

  if (nonEmpty.length === 0) {
    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={0} total={submissions.length} />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">No answers yet</p>
      </div>
    );
  }

  // ── Numeric / Slider / Calculated / Measurement ───────────────────────────
  if (field.type === "number" || field.type === "slider" || field.type === "calculated" ||
      (field.type === "measurement" && field.measurementType !== "BP")) {
    const stats = computeNumericStats(nonEmpty);

    if (isLongitudinal && chartType === "line") {
      const timeSeries = buildTimeSeries(
        submissions.map((s) => ({ value: s.data[field.id], date: s.createdAt })),
      );
      return (
        <div className="brutal p-3">
          <FieldHeader field={field} answered={stats.n} total={submissions.length} />
          <NumericStatsTable stats={stats} />
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={9} stroke="var(--foreground)" />
                <YAxis fontSize={9} stroke="var(--foreground)" />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 3, stroke: "var(--border)", strokeWidth: 2 }} name={field.label} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={stats.n} total={submissions.length} />
        <NumericStatsTable stats={stats} />
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.histogram} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="bin" fontSize={8} stroke="var(--foreground)" angle={-35} textAnchor="end" height={36} />
              <YAxis fontSize={9} stroke="var(--foreground)" allowDecimals={false} />
              <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
              <Bar dataKey="count" fill={color} stroke="var(--border)" strokeWidth={2} name="Count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ── Rating ────────────────────────────────────────────────────────────────
  if (field.type === "rating") {
    const { stats, frequencies } = computeRatingStats(nonEmpty, field.maxRating ?? 5);
    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={stats.n} total={submissions.length} />
        <div className="mb-2 text-sm font-bold">Mean: {stats.mean} / {field.maxRating ?? 5}</div>
        <FrequencyTable rows={frequencies} />
      </div>
    );
  }

  // ── Yes/No / Boolean ──────────────────────────────────────────────────────
  if (field.type === "yes_no" || field.type === "boolean") {
    const { frequencies, n } = computeYesNoStats(nonEmpty.map((v) => (v === true ? "true" : v === false ? "false" : String(v))));
    const pieData = frequencies.map((r) => ({ name: r.label, value: r.count }));
    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={n} total={submissions.length} />
        <FrequencyTable rows={frequencies} />
        {pieData.length > 0 && (
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={28} outerRadius={55} paddingAngle={2} stroke="var(--border)" strokeWidth={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Legend wrapperStyle={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Select one (+ legacy select/radio) ───────────────────────────────────
  if (field.type === "select_one" || field.type === "select" || field.type === "radio") {
    const { frequencies, n } = computeCategoricalStats(nonEmpty, opts);
    const chartData = frequencies.map((r) => ({ name: r.label, value: r.count, percent: r.percent }));
    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={n} total={submissions.length} />
        <FrequencyTable rows={frequencies} />
        {chartType === "pie" ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" paddingAngle={2} stroke="var(--border)" strokeWidth={2}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Legend wrapperStyle={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 4, bottom: 0 }}>
                <XAxis type="number" fontSize={9} stroke="var(--foreground)" allowDecimals={false} />
                <YAxis type="category" dataKey="name" fontSize={9} stroke="var(--foreground)" width={90} />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0 }} />
                <Bar dataKey="value" fill={color} stroke="var(--border)" strokeWidth={2} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Select many / multiselect ─────────────────────────────────────────────
  if (field.type === "select_many" || field.type === "multiselect") {
    const { frequencies, n } = computeCategoricalStats(nonEmpty, opts);
    return (
      <div className="brutal p-3">
        <FieldHeader field={field} answered={n} total={submissions.length} />
        <FrequencyTable rows={frequencies} />
      </div>
    );
  }

  // ── Text / Textarea / Date / Time / Datetime — show recent values ─────────
  return (
    <div className="brutal p-3">
      <FieldHeader field={field} answered={nonEmpty.length} total={submissions.length} />
      <ul className="grid gap-1 max-h-48 overflow-auto">
        {nonEmpty.slice(-8).reverse().map((v, i) => (
          <li key={i} className="border-2 border-border bg-card px-3 py-1.5 text-xs font-semibold">
            {String(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}
