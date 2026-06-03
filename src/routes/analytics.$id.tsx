import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore, type FormDef } from "@/lib/store";
import type { LongitudinalSubmission } from "@/types/longitudinal";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ReferenceLine,
} from "recharts";
import { useMemo, useState } from "react";
import type { FormField, Submission } from "@/lib/store";
import {
  computeNumericStats, computeCategoricalStats, computeYesNoStats,
  computeRatingStats, buildTimeSeries, selectChartType,
  type NumericStats, type FrequencyRow,
} from "@/lib/analytics";
import { Download, List, ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown, Minus, Clock, Users, CheckCircle2, BarChart2, User } from "lucide-react";
import { getFormColor } from "@/lib/formColor";

export const Route = createFileRoute("/analytics/$id")({ component: FormAnalytics });

const COLORS = ["#FFE17C", "#7CFFB0", "#FF7C7C", "#7CB6FF", "#C77CFF", "#FFA07C", "#171E19"];

type DateRange = "7d" | "30d" | "90d" | "all";

function filterByDate(subs: Submission[], range: DateRange): Submission[] {
  if (range === "all") return subs;
  const now = Date.now();
  const ms = { "7d": 7, "30d": 30, "90d": 90 }[range] * 86400000;
  return subs.filter((s) => s.createdAt >= now - ms);
}

function prevPeriodCount(subs: Submission[], range: DateRange): number {
  if (range === "all") return 0;
  const now = Date.now();
  const ms = { "7d": 7, "30d": 30, "90d": 90 }[range] * 86400000;
  return subs.filter((s) => s.createdAt >= now - 2 * ms && s.createdAt < now - ms).length;
}

function timeSince(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function exportCsv(form: { name: string; fields: FormField[] }, subs: Submission[]) {
  const dataFields = form.fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");
  const headers = ["#", "Date", "Time", "Respondent", ...dataFields.map((f) => f.variableName ?? f.label)];
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${form.name.replace(/[^a-z0-9]/gi, "_")}_data.csv`;
  a.click();
}

function FormAnalytics() {
  const { id } = Route.useParams();
  const allForms = useStore((s) => s.forms);
  const allLongSubs = useStore((s) => s.longitudinalSubmissions);
  const rawSubs = useStore((s) => s.submissions);
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  // Derived — stable references via useMemo, never inside useStore selector
  const form = useMemo(() => allForms.find((f) => f.id === id), [allForms, id]);
  const longSubs = useMemo(() => allLongSubs.filter((s) => s.formId === id), [allLongSubs, id]);
  const formColor = getFormColor(id);
  const parentForm = useMemo(() => form?.parentFormId ? allForms.find((f) => f.id === form.parentFormId) : null, [allForms, form]);
  const childForms = useMemo(() => allForms.filter((f) => f.parentFormId === id), [allForms, id]);

  const allSubs = useMemo(
    () => rawSubs.filter((x) => x.formId === id).sort((a, b) => a.createdAt - b.createdAt),
    [rawSubs, id],
  );
  const submissions = useMemo(() => filterByDate(allSubs, dateRange), [allSubs, dateRange]);
  const prevCount = useMemo(() => prevPeriodCount(allSubs, dateRange), [allSubs, dateRange]);

  const dataFields = useMemo(
    () => form?.fields.filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "photo" && f.type !== "location") ?? [],
    [form],
  );

  const completionRate = useMemo(() => {
    if (!submissions.length || !dataFields.length) return 0;
    const total = submissions.reduce((acc, s) => {
      const filled = dataFields.filter((f) => {
        const v = s.data[f.id];
        return v !== undefined && v !== null && v !== "";
      }).length;
      return acc + filled / dataFields.length;
    }, 0);
    return Math.round((total / submissions.length) * 100);
  }, [submissions, dataFields]);

  // All hooks called — now safe to branch on form type
  if (form?.longitudinal) {
    return <LongitudinalAnalytics form={form} subjects={longSubs} />;
  }

  if (!form) {
    return (
      <>
        <PageHeader title="Analytics" back="/analytics" />
        <PageShell><p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p></PageShell>
      </>
    );
  }

  const lastSub = allSubs[allSubs.length - 1];
  const trend = submissions.length - prevCount;
  const trendLabel = dateRange === "all" ? null : trend > 0 ? `+${trend} vs prev period` : trend < 0 ? `${trend} vs prev period` : "same as prev period";

  return (
    <>
      <PageHeader
        title={form.name}
        subtitle={parentForm ? `Child of: ${parentForm.name}` : form.category}
        back={parentForm ? `/analytics/${parentForm.id}` : "/analytics"}
        variant="dark"
        action={
          <div className="flex gap-1.5">
            <Link to="/forms/$id/responses" params={{ id: form.id }} className="border-2 border-border bg-card p-2 hover:bg-muted" title="View all responses">
              <List className="h-4 w-4" />
            </Link>
            {submissions.length > 0 && (
              <button onClick={() => exportCsv(form, submissions)} className="border-2 border-border bg-card p-2 hover:bg-muted" title="Export CSV">
                <Download className="h-4 w-4" />
              </button>
            )}
          </div>
        }
      />
      <PageShell>

        {/* ── Date range filter ── */}
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {(["7d", "30d", "90d", "all"] as DateRange[]).map((r) => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`shrink-0 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${dateRange === r ? "bg-primary" : "hover:bg-muted"}`}>
              {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : r === "90d" ? "90 Days" : "All Time"}
            </button>
          ))}
        </div>

        {/* ── Summary cards ── */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard
            icon={<BarChart2 className="h-4 w-4" />}
            label="Responses"
            value={String(submissions.length)}
            sub={trendLabel ?? `of ${allSubs.length} total`}
            trend={trend}
            color={formColor}
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Completion"
            value={`${completionRate}%`}
            sub="fields answered avg"
            color={formColor}
          />
          <SummaryCard
            icon={<Users className="h-4 w-4" />}
            label="Total ever"
            value={String(allSubs.length)}
            sub="all time responses"
            color={formColor}
          />
          <SummaryCard
            icon={<Clock className="h-4 w-4" />}
            label="Last response"
            value={lastSub ? timeSince(lastSub.createdAt) : "—"}
            sub={lastSub ? new Date(lastSub.createdAt).toLocaleDateString("en-GB") : "no data yet"}
            color={formColor}
          />
        </div>

        {submissions.length === 0 ? (
          <div className="brutal-flat p-12 text-center">
            <BarChart2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-40" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No responses in this period</p>
            {dateRange !== "all" && (
              <button onClick={() => setDateRange("all")} className="mt-3 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase hover:bg-muted">
                View all time
              </button>
            )}
          </div>
        ) : (
          <>
            {/* ── Response timeline ── */}
            <TimelineCard submissions={submissions} color={formColor} dateRange={dateRange} />

            {/* ── Field cards ── */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {dataFields.map((field) => (
                <FieldBlock key={field.id} field={field} submissions={submissions} isLongitudinal={!!form.longitudinal} color={formColor} />
              ))}
            </div>
          </>
        )}

        {/* ── Linked child forms ── */}
        {childForms.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Linked follow-up forms ({childForms.length})
            </div>
            <div className="grid gap-2">
              {childForms.map((child) => {
                const childSubs = rawSubs.filter((s) => s.formId === child.id);
                const childColor = getFormColor(child.id);
                return (
                  <Link
                    key={child.id}
                    to="/analytics/$id"
                    params={{ id: child.id }}
                    className="brutal flex items-center gap-3 p-3 hover:bg-primary/20"
                  >
                    <div className="h-9 w-9 shrink-0 border-2 border-border flex items-center justify-center text-[10px] font-bold"
                      style={{ background: childColor }}>
                      {childSubs.length}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-sm uppercase truncate">{child.name}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        {childSubs.length} response{childSubs.length !== 1 ? "s" : ""} · {child.fields.filter(f => f.type !== "section_header").length} fields
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}

// ── Longitudinal analytics ────────────────────────────────────────────────────

function LongitudinalAnalytics({ form, subjects }: { form: FormDef; subjects: LongitudinalSubmission[] }) {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const formColor = getFormColor(form.id);

  const fixedIds = new Set(form.fixedFieldIds ?? []);
  const fixedFields = form.fields.filter((f) => fixedIds.has(f.id) && f.type !== "section_header");
  const trackedFields = form.fields.filter((f) => !fixedIds.has(f.id) && f.type !== "section_header" && f.type !== "page_break");

  // Find the "name" field — first short_text or text in fixed fields, or fallback to subjectKey
  const nameField = fixedFields.find((f) => f.type === "short_text" || f.type === "text") ?? fixedFields[0];

  const getSubjectName = (s: LongitudinalSubmission) =>
    nameField ? String(s.fixedData[nameField.id] ?? s.subjectKey) : s.subjectKey;

  const totalVisits = subjects.reduce((n, s) => n + s.visits.length, 0);
  const lastVisit = subjects.flatMap((s) => s.visits).map((v) => new Date(v.timestamp).getTime()).sort((a, b) => b - a)[0];

  const selected = selectedSubject ? subjects.find((s) => s.id === selectedSubject) : null;

  return (
    <>
      <PageHeader
        title={form.name}
        subtitle={`${subjects.length} participants · ${totalVisits} visits`}
        back="/analytics"
        variant="dark"
        action={
          <Link to="/forms/$id/responses" params={{ id: form.id }} className="border-2 border-border bg-card p-2 hover:bg-muted" title="Raw data">
            <List className="h-4 w-4" />
          </Link>
        }
      />
      <PageShell>
        {/* Summary row */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="brutal p-3" style={{ borderLeftColor: formColor, borderLeftWidth: 4 }}>
            <div className="font-display text-3xl">{subjects.length}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-1">Participants</div>
          </div>
          <div className="brutal p-3" style={{ borderLeftColor: formColor, borderLeftWidth: 4 }}>
            <div className="font-display text-3xl">{totalVisits}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-1">Total visits</div>
            <div className="text-[9px] text-muted-foreground">{subjects.length ? (totalVisits / subjects.length).toFixed(1) : 0} avg/person</div>
          </div>
          <div className="brutal p-3" style={{ borderLeftColor: formColor, borderLeftWidth: 4 }}>
            <div className="font-display text-lg leading-tight">{lastVisit ? new Date(lastVisit).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-1">Last visit</div>
          </div>
        </div>

        {subjects.length === 0 ? (
          <div className="brutal-flat p-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-40" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No participants yet</p>
          </div>
        ) : (
          <>
            {/* Participant list */}
            <div className="brutal mb-4">
              <div className="flex items-center justify-between border-b-2 border-border px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest">Participants</span>
                {selected && (
                  <button onClick={() => setSelectedSubject(null)} className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
                    ← All participants
                  </button>
                )}
              </div>
              {subjects.map((s) => {
                const name = getSubjectName(s);
                const last = s.visits[s.visits.length - 1];
                const first = s.visits[0];
                const isSelected = selectedSubject === s.id;
                return (
                  <div key={s.id}>
                    <button
                      onClick={() => setSelectedSubject(isSelected ? null : s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-border text-left hover:bg-muted/50 transition-colors ${isSelected ? "bg-primary/10" : ""}`}
                    >
                      <div className="h-8 w-8 shrink-0 border-2 border-border flex items-center justify-center text-[10px] font-bold"
                        style={{ background: formColor }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm truncate">{name}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {s.visits.length} visit{s.visits.length !== 1 ? "s" : ""}
                          {first ? ` · first: ${new Date(first.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}` : ""}
                          {last && s.visits.length > 1 ? ` · last: ${new Date(last.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs font-bold tabular-nums">{s.visits.length}</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${isSelected ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {/* Expanded: individual participant timeline */}
                    {isSelected && (
                      <div className="bg-muted/20 border-b-2 border-border p-3 space-y-4">
                        {/* Fixed data */}
                        {fixedFields.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {fixedFields.map((f) => (
                              <div key={f.id} className="border border-border bg-card px-2 py-1">
                                <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">{f.label}</div>
                                <div className="text-xs font-bold">{String(s.fixedData[f.id] ?? "—")}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Visit table */}
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Visit history</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="border-b-2 border-border">
                                  <th className="text-left py-1 pr-3 font-bold uppercase tracking-wider text-[9px] whitespace-nowrap">Visit</th>
                                  <th className="text-left py-1 pr-3 font-bold uppercase tracking-wider text-[9px] whitespace-nowrap">Date</th>
                                  {trackedFields.map((f) => (
                                    <th key={f.id} className="text-left py-1 pr-3 font-bold uppercase tracking-wider text-[9px] whitespace-nowrap">
                                      {f.label}{f.unit ? ` (${f.unit})` : ""}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {s.visits.map((v, i) => (
                                  <tr key={v.visitId} className="border-b border-border hover:bg-muted/30">
                                    <td className="py-1.5 pr-3 font-bold text-muted-foreground">{i + 1}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(v.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                                    {trackedFields.map((f) => {
                                      const val = v.data[f.id];
                                      const prev = i > 0 ? s.visits[i - 1].data[f.id] : null;
                                      const num = Number(val);
                                      const prevNum = Number(prev);
                                      const changed = prev !== null && Number.isFinite(num) && Number.isFinite(prevNum) && num !== prevNum;
                                      return (
                                        <td key={f.id} className="py-1.5 pr-3 font-semibold">
                                          <span>{val === undefined || val === null || val === "" ? "—" : String(val)}</span>
                                          {changed && (
                                            <span className={`ml-1 text-[9px] font-bold ${num > prevNum ? "text-red-500" : "text-green-600"}`}>
                                              {num > prevNum ? `↑${(num - prevNum).toFixed(1)}` : `↓${(prevNum - num).toFixed(1)}`}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Trend charts for numeric tracked fields */}
                        {trackedFields.filter((f) => f.type === "number" || f.type === "measurement" || f.type === "slider").map((f) => {
                          const pts = s.visits
                            .map((v, i) => ({ x: `V${i + 1}`, y: Number(v.data[f.id]) }))
                            .filter((p) => Number.isFinite(p.y));
                          if (pts.length < 2) return null;
                          return (
                            <div key={f.id}>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                                {f.label}{f.unit ? ` (${f.unit})` : ""} — trend
                              </div>
                              <div className="h-28">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={pts} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="x" fontSize={9} tick={{ fill: "var(--muted-foreground)" }} />
                                    <YAxis fontSize={9} tick={{ fill: "var(--muted-foreground)" }} />
                                    <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }} />
                                    <Line type="monotone" dataKey="y" stroke={formColor} strokeWidth={2.5}
                                      dot={{ fill: formColor, r: 4, stroke: "var(--border)", strokeWidth: 2 }}
                                      name={f.label} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Aggregate stats across all participants' visits */}
            {trackedFields.length > 0 && (
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Aggregate — all {totalVisits} visits
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {trackedFields.map((f) => {
                    const allVals = subjects.flatMap((s) => s.visits.map((v) => v.data[f.id]));
                    const nonEmpty = allVals.filter((v) => v !== undefined && v !== null && v !== "");
                    if (nonEmpty.length === 0) return null;
                    const opts = f.optionObjects?.length ? f.optionObjects : (f.options ?? []).map((o) => ({ label: o, value: o }));
                    return (
                      <FieldBlock key={f.id} field={f} submissions={subjects.flatMap((s) =>
                        s.visits.map((v) => ({ formId: form.id, data: v.data, createdAt: new Date(v.timestamp).getTime() } as Submission))
                      )} isLongitudinal={false} color={formColor} />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </PageShell>
    </>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, sub, trend, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; trend?: number; color: string;
}) {
  return (
    <div className="brutal p-3 flex flex-col gap-1" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{icon}</span>
        {trend !== undefined && trend !== 0 && (
          trend > 0
            ? <TrendingUp className="h-3.5 w-3.5 text-green-600" />
            : <TrendingDown className="h-3.5 w-3.5 text-destructive" />
        )}
        {trend === 0 && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="font-display text-2xl uppercase leading-none">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-[9px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

// ── Timeline card ─────────────────────────────────────────────────────────────

function TimelineCard({ submissions, color, dateRange }: { submissions: Submission[]; color: string; dateRange: DateRange }) {
  const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : 60;

  const data = useMemo(() => {
    const buckets: { date: string; n: number }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const start = d.getTime(); const end = start + 86400000;
      const label = days > 30
        ? (i % 7 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : "")
        : `${d.getMonth() + 1}/${d.getDate()}`;
      buckets.push({ date: label, n: submissions.filter((s) => s.createdAt >= start && s.createdAt < end).length });
    }
    return buckets;
  }, [submissions, days]);

  const avg = (data.reduce((s, d) => s + d.n, 0) / data.length) || 0;

  return (
    <div className="brutal p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest">Response trend</h3>
        <span className="text-[9px] text-muted-foreground">avg {avg.toFixed(1)}/day</span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" fontSize={8} stroke="var(--foreground)" tick={{ fill: "var(--muted-foreground)" }} />
            <YAxis fontSize={9} stroke="var(--foreground)" allowDecimals={false} tick={{ fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }}
              cursor={{ fill: "var(--muted)" }}
            />
            <ReferenceLine y={avg} stroke="var(--foreground)" strokeDasharray="4 4" strokeOpacity={0.4} />
            <Bar dataKey="n" fill={color} stroke="var(--border)" strokeWidth={1.5} name="Responses" radius={[1, 1, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Field block ───────────────────────────────────────────────────────────────

function FieldBlock({ field, submissions, isLongitudinal, color }: {
  field: FormField; submissions: Submission[]; isLongitudinal: boolean; color: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const raw = submissions.map((s) => s.data[field.id]);
  const nonEmpty = raw.filter((v) => v !== undefined && v !== null && v !== "");
  const answered = nonEmpty.length;
  const total = submissions.length;
  const completionPct = total ? Math.round((answered / total) * 100) : 0;

  const opts = field.optionObjects?.length ? field.optionObjects : (field.options ?? []).map((o) => ({ label: o, value: o }));
  const chartType = selectChartType(field.type, opts.length, isLongitudinal);

  // Header always shown
  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="font-display text-sm uppercase leading-tight truncate">{field.label}
          {field.unit ? <span className="ml-1 text-[9px] tracking-widest text-muted-foreground font-sans normal-case">({field.unit})</span> : null}
        </h3>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden border border-border bg-muted max-w-[80px]">
            <div className="h-full bg-primary transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <span className="text-[9px] font-bold text-muted-foreground tabular-nums">{answered}/{total}</span>
        </div>
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="shrink-0 border border-border p-1 hover:bg-muted mt-0.5"
        title={expanded ? "Collapse" : "Expand"}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
    </div>
  );

  if (answered === 0) {
    return (
      <div className="brutal p-3 opacity-60">
        {header}
        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">No answers yet</p>
      </div>
    );
  }

  // ── Numeric ───────────────────────────────────────────────────────────────
  if (["number", "slider", "calculated", "measurement"].includes(field.type) && field.measurementType !== "BP") {
    const stats = computeNumericStats(nonEmpty);
    return (
      <div className="brutal p-3">
        {header}
        {/* Big number highlight */}
        <div className="mt-3 flex items-end gap-3">
          <div>
            <div className="font-display text-4xl uppercase leading-none">{stats.mean}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">mean{field.unit ? ` (${field.unit})` : ""}</div>
          </div>
          <div className="pb-1 text-right text-xs text-muted-foreground space-y-0.5">
            <div>median {stats.median}</div>
            <div>sd ±{stats.sd}</div>
          </div>
        </div>

        {/* Compact stat pills */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { l: "Min", v: stats.min }, { l: "Max", v: stats.max },
            { l: "IQR", v: `${stats.p25}–${stats.p75}` },
            { l: "95% CI", v: `${stats.ci95Lower}–${stats.ci95Upper}` },
          ].map(({ l, v }) => (
            <div key={l} className="border border-border bg-card px-2 py-0.5 text-[9px] font-bold">
              <span className="text-muted-foreground uppercase">{l} </span>{v}
            </div>
          ))}
        </div>

        {/* Chart — always visible if space, or only when expanded */}
        {(expanded || nonEmpty.length > 1) && (
          <div className="mt-3 h-32">
            <ResponsiveContainer width="100%" height="100%">
              {isLongitudinal && chartType === "line" ? (
                <LineChart
                  data={buildTimeSeries(submissions.map((s) => ({ value: s.data[field.id], date: s.createdAt })))}
                  margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" fontSize={8} tick={{ fill: "var(--muted-foreground)" }} />
                  <YAxis fontSize={9} tick={{ fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }} />
                  <ReferenceLine y={stats.mean} stroke="var(--foreground)" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 2.5, stroke: "var(--border)", strokeWidth: 1.5 }} name={field.label} />
                </LineChart>
              ) : (
                <BarChart data={stats.histogram} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="bin" fontSize={7} angle={-30} textAnchor="end" height={32} tick={{ fill: "var(--muted-foreground)" }} />
                  <YAxis fontSize={9} allowDecimals={false} tick={{ fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }} />
                  <Bar dataKey="count" fill={color} stroke="var(--border)" strokeWidth={1.5} radius={[1, 1, 0, 0]} name="Count" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Yes/No ────────────────────────────────────────────────────────────────
  if (field.type === "yes_no" || field.type === "boolean") {
    const { frequencies, n } = computeYesNoStats(nonEmpty.map((v) => (v === true ? "true" : v === false ? "false" : String(v))));
    const top = frequencies[0];
    return (
      <div className="brutal p-3">
        {header}
        <div className="mt-3 flex items-end gap-3">
          <div>
            <div className="font-display text-4xl uppercase leading-none">{top?.percent ?? 0}%</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{top?.label ?? "—"} (n={n})</div>
          </div>
        </div>
        <div className="mt-2 space-y-1.5">
          {frequencies.map((r) => (
            <div key={String(r.value)} className="flex items-center gap-2">
              <span className="w-8 text-[10px] font-bold uppercase">{r.label}</span>
              <div className="flex-1 h-3 border border-border bg-muted overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${r.percent}%`, background: color }} />
              </div>
              <span className="w-10 text-right text-[10px] font-bold tabular-nums">{r.percent}%</span>
              <span className="w-6 text-right text-[9px] text-muted-foreground">{r.count}</span>
            </div>
          ))}
        </div>
        {expanded && (
          <div className="mt-3 h-28">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={frequencies.map((r) => ({ name: r.label, value: r.count }))} dataKey="value" nameKey="name"
                  innerRadius={22} outerRadius={42} paddingAngle={3} stroke="var(--border)" strokeWidth={2}>
                  {frequencies.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 9, textTransform: "uppercase", fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Select one ────────────────────────────────────────────────────────────
  if (["select_one", "select", "radio"].includes(field.type)) {
    const { frequencies, n } = computeCategoricalStats(nonEmpty, opts);
    const top = frequencies[0];
    return (
      <div className="brutal p-3">
        {header}
        <div className="mt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Top answer (n={n})</div>
        <div className="mt-0.5 font-display text-base uppercase truncate">{top?.label ?? "—"} — {top?.percent ?? 0}%</div>
        <div className="mt-2 space-y-1">
          {frequencies.slice(0, expanded ? undefined : 4).map((r) => (
            <div key={String(r.value)} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px] font-bold">{r.label}</span>
              <div className="w-20 h-2 border border-border bg-muted overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${r.percent}%`, background: color }} />
              </div>
              <span className="w-8 text-right text-[9px] font-bold tabular-nums">{r.percent}%</span>
            </div>
          ))}
        </div>
        {expanded && frequencies.length > 4 && (
          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frequencies.map((r) => ({ name: r.label, value: r.count, pct: r.percent }))} layout="vertical"
                margin={{ top: 0, right: 28, left: 4, bottom: 0 }}>
                <XAxis type="number" fontSize={9} allowDecimals={false} tick={{ fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="name" fontSize={9} width={88} tick={{ fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }} />
                <Bar dataKey="value" fill={color} stroke="var(--border)" strokeWidth={1.5} radius={[0, 1, 1, 0]} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Select many ───────────────────────────────────────────────────────────
  if (["select_many", "multiselect"].includes(field.type)) {
    const { frequencies, n } = computeCategoricalStats(nonEmpty, opts);
    return (
      <div className="brutal p-3">
        {header}
        <div className="mt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">n={n} responses (multi-select)</div>
        <div className="mt-2 space-y-1">
          {frequencies.slice(0, expanded ? undefined : 5).map((r) => (
            <div key={String(r.value)} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px] font-bold">{r.label}</span>
              <div className="w-20 h-2 border border-border bg-muted overflow-hidden">
                <div className="h-full" style={{ width: `${r.percent}%`, background: color }} />
              </div>
              <span className="w-8 text-right text-[9px] tabular-nums">{r.percent}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Rating ────────────────────────────────────────────────────────────────
  if (field.type === "rating") {
    const { stats, frequencies } = computeRatingStats(nonEmpty, field.maxRating ?? 5);
    return (
      <div className="brutal p-3">
        {header}
        <div className="mt-3 flex items-end gap-2">
          <div className="font-display text-4xl uppercase leading-none">{stats.mean}</div>
          <div className="pb-1 text-[9px] font-bold uppercase text-muted-foreground">/ {field.maxRating ?? 5}</div>
        </div>
        <div className="mt-2 space-y-1">
          {frequencies.map((r) => (
            <div key={String(r.value)} className="flex items-center gap-2">
              <span className="w-4 text-center text-[10px] font-bold">{"★".repeat(Number(r.value))}</span>
              <div className="flex-1 h-2 border border-border bg-muted overflow-hidden">
                <div className="h-full" style={{ width: `${r.percent}%`, background: color }} />
              </div>
              <span className="w-8 text-right text-[9px] tabular-nums">{r.percent}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Text / Date / Other — recent values list ──────────────────────────────
  return (
    <div className="brutal p-3">
      {header}
      <div className="mt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{answered} answers</div>
      <ul className="mt-2 space-y-1 max-h-36 overflow-auto">
        {nonEmpty.slice(-(expanded ? 20 : 5)).reverse().map((v, i) => (
          <li key={i} className="border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold truncate">{String(v)}</li>
        ))}
      </ul>
    </div>
  );
}

// keep NumericStats used in imports satisfied
type _NS = NumericStats;
type _FR = FrequencyRow;
