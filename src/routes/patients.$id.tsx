import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, store, ageFromDob } from "@/lib/store";
import type { LongitudinalSubmission } from "@/types/longitudinal";
import { useAuth } from "@/lib/auth";
import { AuthRequired } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { ClipboardPlus, Phone, MapPin, Calendar, Trash2, Activity, AlertTriangle } from "lucide-react";
import {
  buildHAZRef, buildWAZRef, computeVisitZScores,
  getLMSValue, zColor, applyPositionCorrection,
  type ChartRefPoint,
} from "@/lib/who-lms";

export const Route = createFileRoute("/patients/$id")({ component: PatientDetail });

// ── Helpers ───────────────────────────────────────────────────────────────────

function zLabel(z: number | null): string {
  if (z === null) return "—";
  return (z > 0 ? "+" : "") + z.toFixed(2);
}

function hazClassLabel(z: number | null): string {
  if (z === null) return "—";
  if (z < -3) return "Severely Stunted";
  if (z < -2) return "Stunted";
  if (z > 2)  return "Tall";
  return "Normal";
}
function wazClassLabel(z: number | null): string {
  if (z === null) return "—";
  if (z < -3) return "Severely Underweight";
  if (z < -2) return "Underweight";
  if (z > 2)  return "Overweight";
  return "Normal";
}

// ── Z-Score dot renderer ──────────────────────────────────────────────────────

interface DotPayload {
  childValue?: number | null;
  L?: number; M?: number; S?: number;
  [k: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ZDot(props: any) {
  const { cx, cy, payload, unit } = props as { cx: number; cy: number; payload: DotPayload; unit: string };
  const v = payload.childValue;
  if (v === null || v === undefined) return null;

  const z =
    payload.L !== undefined && payload.M !== undefined && payload.S !== undefined
      ? computeZScore(v, payload.L, payload.M, payload.S)
      : null;

  const color = zColor(z);
  return (
    <g>
      <circle cx={cx} cy={cy} r={13} fill={color} opacity={0.12} />
      <circle cx={cx} cy={cy} r={7}  fill={color} stroke="white" strokeWidth={2} />
      <text x={cx} y={cy - 20} textAnchor="middle" fontSize={11} fontWeight="700" fill={color}>
        {v.toFixed(1)} {unit}
      </text>
      {z !== null && (
        <text x={cx} y={cy + 23} textAnchor="middle" fontSize={10} fill={color}>
          Z = {zLabel(z)}
        </text>
      )}
    </g>
  );
}

// import in the function component scope so TypeScript is happy
function computeZScore(X: number, L: number, M: number, S: number): number {
  if (X <= 0 || M <= 0) return 0;
  let z: number;
  if (Math.abs(L) < 0.001) {
    z = Math.log(X / M) / S;
  } else {
    z = (Math.pow(X / M, L) - 1) / (L * S);
  }
  if (z > 3) {
    const sd3p = getLMSValue(L, M, S, 3);
    const sd2p = getLMSValue(L, M, S, 2);
    if (sd3p > sd2p) return 3 + (X - sd3p) / (sd3p - sd2p);
  }
  if (z < -3) {
    const sd3n = getLMSValue(L, M, S, -3);
    const sd2n = getLMSValue(L, M, S, -2);
    if (sd2n > sd3n) return -3 + (X - sd3n) / (sd2n - sd3n);
  }
  return Math.round(z * 100) / 100;
}

// ── WHO chart component ───────────────────────────────────────────────────────

interface ChildPoint { age: number; value: number }

function WHOChart({
  refPts, childPts, unit, title,
}: {
  refPts: ChartRefPoint[];
  childPts: ChildPoint[];
  unit: string;
  title: string;
}) {
  const chartData = useMemo(() => {
    const byAge = new Map(childPts.map((p) => [p.age, p.value]));
    const allAges = Array.from(
      new Set([...refPts.map((r) => r.age), ...childPts.map((p) => p.age)]),
    ).sort((a, b) => a - b);

    return allAges.map((age) => {
      const ref = refPts.find((r) => r.age === age);
      const childValue = byAge.get(age) ?? null;
      if (ref) {
        return { age, sd3n: ref.sd3n, sd2n: ref.sd2n, med: ref.med, sd2p: ref.sd2p, sd3p: ref.sd3p, L: ref.L, M: ref.M, S: ref.S, childValue };
      }
      // child point without a ref point — interpolate nearest ref
      const nearest = refPts.reduce((a, b) =>
        Math.abs(a.age - age) <= Math.abs(b.age - age) ? a : b,
      );
      return { age, sd3n: nearest.sd3n, sd2n: nearest.sd2n, med: nearest.med, sd2p: nearest.sd2p, sd3p: nearest.sd3p, L: nearest.L, M: nearest.M, S: nearest.S, childValue };
    });
  }, [refPts, childPts]);

  const [yMin, yMax] = useMemo(() => {
    const vals = chartData
      .flatMap((d) => [d.sd3n, d.sd3p, d.childValue])
      .filter((v): v is number => typeof v === "number" && isFinite(v) && v > 0);
    if (!vals.length) return [0, 100] as [number, number];
    const range = Math.max(...vals) - Math.min(...vals);
    const pad = range * 0.05;
    return [Math.floor(Math.min(...vals) - pad), Math.ceil(Math.max(...vals) + pad)] as [number, number];
  }, [chartData]);

  if (!refPts.length) return null;

  return (
    <div className="brutal p-3">
      <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest">{title}</div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 28, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="age"
              tickFormatter={(v) => `${v}m`}
              fontSize={9}
              stroke="var(--foreground)"
            />
            <YAxis
              fontSize={9}
              stroke="var(--foreground)"
              domain={[yMin, yMax]}
              tickFormatter={(v) => `${Math.round(v)}`}
              unit={` ${unit}`}
              width={44}
            />
            <Tooltip
              formatter={(val: number, name: string) => {
                const labels: Record<string, string> = {
                  childValue: "Child", med: "Median",
                  sd2n: "−2 SD", sd3n: "−3 SD", sd2p: "+2 SD", sd3p: "+3 SD",
                };
                return [`${val.toFixed(1)} ${unit}`, labels[name] ?? name];
              }}
              labelFormatter={(v) => `Age: ${v} months`}
              contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }}
            />
            <Line type="monotone" dataKey="sd3n" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd3n" />
            <Line type="monotone" dataKey="sd2n" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd2n" />
            <Line type="monotone" dataKey="med"  stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 2" dot={false} name="med" />
            <Line type="monotone" dataKey="sd2p" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd2p" />
            <Line type="monotone" dataKey="sd3p" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd3p" />
            <Line
              type="monotone"
              dataKey="childValue"
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={(p) => <ZDot key={`zdot-${p.index}`} {...p} unit={unit} />}
              activeDot={{ r: 9 }}
              connectNulls
              name="childValue"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 px-1">
        {[
          { color: "#ef4444", label: "±3 SD" },
          { color: "#f97316", label: "±2 SD" },
          { color: "#22c55e", label: "Median" },
          { color: "var(--primary)", label: "Child" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            <span className="inline-block h-2 w-4 shrink-0" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function PatientDetail() {
  const { user } = useAuth();
  const { id } = Route.useParams();
  const nav = useNavigate();
  const patient = useStore((s) => s.patients.find((p) => p.id === id));
  const allSubmissions = useStore((s) => s.submissions);
  const submissions = useMemo(
    () => allSubmissions.filter((x) => x.patientId === id).sort((a, b) => a.createdAt - b.createdAt),
    [allSubmissions, id],
  );
  const forms = useStore((s) => s.forms);
  const [picker, setPicker] = useState(false);
  const longitudinalSubmissions = useStore(s => s.longitudinalSubmissions);
  const trackedForms = useMemo<LongitudinalSubmission[]>(() => {
    if (!patient) return [];
    return longitudinalSubmissions.filter(s => s.patientId === patient.id);
  }, [longitudinalSubmissions, patient]);
  const [expandedDatasheet, setExpandedDatasheet] = useState<string | null>(null);

  const dobMs = patient ? new Date(patient.dob).getTime() : 0;
  const sex   = patient?.sex ?? "";

  // ── Extract weight/height visit points ──────────────────────────────────────

  interface VisitPoint {
    ageMonths: number;
    weight: number | undefined;
    height: number | undefined;
    date: number;
    subId: string;
  }

  const visitPoints = useMemo((): VisitPoint[] => {
    if (!patient) return [];
    const results: VisitPoint[] = [];
    for (const s of submissions) {
      const form = forms.find((f) => f.id === s.formId);
      if (!form) continue;
      const ageMonths = (s.createdAt - dobMs) / (1000 * 60 * 60 * 24 * 30.4375);
      if (!Number.isFinite(ageMonths) || ageMonths < 0 || ageMonths > 60) continue;
      const ageMo = Math.round(ageMonths * 10) / 10;

      let weight: number | undefined, height: number | undefined;
      for (const f of form.fields) {
        if (f.type !== "number") continue;
        const raw = s.data[f.id];
        const v = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
        if (!isFinite(v) || v <= 0) continue;
        const lbl = f.label.toLowerCase();
        if (!weight && (lbl.includes("weight") || lbl.includes("wt") || lbl.includes("wgt"))) weight = v;
        if (!height && (lbl.includes("height") || lbl.includes("length") || lbl.includes("ht") || lbl.includes("len"))) {
          height = applyPositionCorrection(v, ageMo, false);
        }
      }
      if (!weight && !height) continue;
      results.push({ ageMonths: ageMo, weight, height, date: s.createdAt, subId: s.id });
    }
    return results;
  }, [submissions, forms, patient, dobMs]);

  // ── Latest Z-scores ──────────────────────────────────────────────────────────

  const latestZScores = useMemo(() => {
    let last: VisitPoint | undefined;
    for (const v of visitPoints) {
      if (v.weight !== undefined && v.height !== undefined) last = v;
    }
    if (!last || !last.weight || !last.height) return null;
    return computeVisitZScores(sex, last.ageMonths, last.weight, last.height);
  }, [visitPoints, sex]);

  // ── Chart data ──────────────────────────────────────────────────────────────

  const { hazRef, wazRef, hazPts, wazPts } = useMemo(() => {
    const htPts = visitPoints.filter((v) => v.height !== undefined)
      .map((v) => ({ age: v.ageMonths, value: v.height! }));
    const wtPts = visitPoints.filter((v) => v.weight !== undefined)
      .map((v) => ({ age: v.ageMonths, value: v.weight! }));

    if (!htPts.length && !wtPts.length) return { hazRef: [], wazRef: [], hazPts: [], wazPts: [] };

    const allAges = [...htPts, ...wtPts].map((p) => p.age);
    const minAge  = Math.max(0, Math.min(...allAges) - 3);
    const maxAge  = Math.min(60, Math.max(...allAges) + 3);

    return {
      hazRef: htPts.length ? buildHAZRef(sex, minAge, maxAge) : [],
      wazRef: wtPts.length ? buildWAZRef(sex, minAge, maxAge) : [],
      hazPts: htPts,
      wazPts: wtPts,
    };
  }, [visitPoints, sex]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (!user) return <AuthRequired action="track patients" />;

  if (!patient) {
    return (
      <>
        <PageHeader title="Patient" back="/patients" />
        <PageShell>
          <div className="brutal-flat p-8 text-center text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Patient not found
          </div>
        </PageShell>
      </>
    );
  }

  const remove = () => {
    if (confirm("Delete this patient and all their visits?")) {
      store.deletePatient(patient.id);
      nav({ to: "/patients" });
    }
  };

  return (
    <>
      <PageHeader
        title={patient.name}
        back="/patients"
        subtitle={`${patient.sex} · ${ageFromDob(patient.dob)}`}
        variant="yellow"
      />
      <PageShell>

        {/* ── Demographics ─────────────────────────────────────────────────── */}
        <section className="brutal p-4">
          <div className="grid grid-cols-2 gap-3">
            <Info icon={Calendar} label="DOB" value={new Date(patient.dob).toLocaleDateString()} />
            <Info icon={MapPin}   label="Village" value={patient.village} />
            {patient.phone && <Info icon={Phone}    label="Phone" value={patient.phone} />}
            <Info icon={Activity} label="Status" value={patient.status} />
          </div>
          {patient.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {patient.tags.map((t) => (
                <span key={t} className="chip chip-yellow">{t}</span>
              ))}
            </div>
          )}
        </section>

        {/* ── Latest Z-score status card ───────────────────────────────────── */}
        {latestZScores && (
          <section className="mt-4">
            <SectionTitle kicker="Latest">Nutritional status</SectionTitle>

            {latestZScores.isSAM && (
              <div className="brutal border-destructive bg-destructive/10 p-3 mb-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  SEVERE ACUTE MALNUTRITION (SAM) — Refer to NRC immediately
                </div>
                <div className="mt-1 text-[10px] text-destructive">
                  Criterion: {latestZScores.samCriteria}
                </div>
              </div>
            )}
            {!latestZScores.isSAM && latestZScores.isMAM && (
              <div className="brutal border-[#f59e0b] bg-amber-50/30 p-3 mb-3">
                <div className="text-[11px] font-bold uppercase tracking-widest text-amber-600">
                  Moderate Acute Malnutrition (MAM) — Monitor closely
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "WAZ", z: latestZScores.waz, label: latestZScores.wazLabel },
                { key: "HAZ", z: latestZScores.haz, label: latestZScores.hazLabel },
                { key: "WHZ", z: latestZScores.whz, label: latestZScores.whz !== null ? (latestZScores.whz < -3 ? "SAM" : latestZScores.whz < -2 ? "MAM" : "Normal") : "—" },
              ].map(({ key, z, label }) => (
                <div key={key} className="brutal p-3 text-center">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{key}</div>
                  <div
                    className="mt-1 text-xl font-black font-mono"
                    style={{ color: zColor(z) }}
                  >
                    {zLabel(z)}
                  </div>
                  <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: zColor(z) }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Record visit ─────────────────────────────────────────────────── */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setPicker(true)}
            className="btn-brutal flex flex-1 items-center justify-center gap-1.5 text-xs"
          >
            <ClipboardPlus className="h-4 w-4" /> Record visit
          </button>
          <button
            onClick={remove}
            className="border-2 border-border bg-card p-2 hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Delete patient"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* ── Growth charts ────────────────────────────────────────────────── */}
        {(hazPts.length > 0 || wazPts.length > 0) && (
          <section className="mt-6">
            <SectionTitle kicker="WHO 2006">Growth charts</SectionTitle>
            <div className="grid gap-3">
              {hazPts.length > 0 && hazRef.length > 0 && (
                <WHOChart
                  refPts={hazRef}
                  childPts={hazPts}
                  unit="cm"
                  title="Height / Length-for-Age (cm)"
                />
              )}
              {wazPts.length > 0 && wazRef.length > 0 && (
                <WHOChart
                  refPts={wazRef}
                  childPts={wazPts}
                  unit="kg"
                  title="Weight-for-Age (kg)"
                />
              )}
            </div>
          </section>
        )}

        {/* ── Visit timeline ───────────────────────────────────────────────── */}
        <section className="mt-6">
          <SectionTitle kicker={`${submissions.length}`}>Timeline</SectionTitle>
          {submissions.length === 0 ? (
            <div className="brutal-flat p-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
              No visits recorded yet
            </div>
          ) : (
            <ol className="relative space-y-3 border-l-[3px] border-border pl-5">
              {[...submissions].reverse().map((s) => {
                const form = forms.find((f) => f.id === s.formId);
                return (
                  <li key={s.id} className="relative">
                    <span className="absolute -left-[27px] top-2 h-3 w-3 border-2 border-border bg-primary" />
                    <div className="brutal p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-display text-base uppercase">{s.formName}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {new Date(s.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {form && (
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          {form.fields.slice(0, 6).map((f) => {
                            const v = s.data[f.id];
                            if (v === undefined || v === "" || v === null) return null;
                            if (Array.isArray(v) && v.length === 0) return null;
                            let display: string;
                            if (typeof v === "boolean") display = v ? "Yes" : "No";
                            else if (Array.isArray(v)) display = v.join(", ");
                            else if (
                              v && typeof v === "object" &&
                              "lat" in (v as Record<string, unknown>) &&
                              "lng" in (v as Record<string, unknown>)
                            ) {
                              const g = v as { lat: number; lng: number };
                              display = `${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
                            } else display = String(v);
                            return (
                              <div key={f.id} className="flex justify-between gap-2">
                                <dt className="truncate font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</dt>
                                <dd className="truncate font-mono font-bold">
                                  {display}{f.unit ? ` ${f.unit}` : ""}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* ── Tracked Forms (Longitudinal) ─────────────────────────────────── */}
        {trackedForms.length > 0 && (
          <section className="mt-6">
            <SectionTitle>Tracked Forms</SectionTitle>
            <div className="space-y-3">
              {trackedForms.map(sub => {
                const form = forms.find(f => f.id === sub.formId);
                const formName = form?.name ?? sub.formId;
                const firstVisit = sub.visits[0]?.timestamp;
                const lastVisit = sub.visits[sub.visits.length - 1]?.timestamp;
                const isExpanded = expandedDatasheet === sub.id;
                const trackedFields = form?.fields.filter(f => f.longitudinalRole !== 'fixed' && f.type !== 'section_header' && f.type !== 'page_break') ?? [];
                return (
                  <div key={sub.id} className="brutal-flat p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm">{formName}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {sub.visits.length} visit{sub.visits.length !== 1 ? 's' : ''}
                          {firstVisit ? ` · First: ${new Date(firstVisit).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                          {lastVisit && lastVisit !== firstVisit ? ` · Last: ${new Date(lastVisit).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedDatasheet(isExpanded ? null : sub.id)}
                        className="shrink-0 border-2 border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                      >
                        {isExpanded ? 'Hide ▲' : 'View Datasheet ▼'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs border-collapse min-w-max">
                          <thead>
                            <tr className="border-b-2 border-border">
                              <th className="px-2 py-1 text-left font-bold uppercase tracking-wider text-[10px]">Visit</th>
                              <th className="px-2 py-1 text-left font-bold uppercase tracking-wider text-[10px]">Date</th>
                              {trackedFields.map(f => (
                                <th key={f.id} className="px-2 py-1 text-left font-bold uppercase tracking-wider text-[10px]">{f.label}{f.unit ? ` (${f.unit})` : ''}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sub.visits.map((visit, i) => (
                              <tr key={visit.visitId} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                                <td className="px-2 py-1 font-bold">Visit {i + 1}</td>
                                <td className="px-2 py-1 text-muted-foreground">{new Date(visit.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                {trackedFields.map(f => (
                                  <td key={f.id} className="px-2 py-1">{String(visit.data[f.id] ?? '—')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {form?.shareToken && (
                          <div className="mt-2">
                            <a
                              href={`/f/${form.shareToken}?subject=${encodeURIComponent(sub.subjectKey)}`}
                              className="inline-flex items-center gap-1 border-2 border-border bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/80"
                            >
                              + Add New Visit
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Form picker modal ────────────────────────────────────────────── */}
        {picker && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4" onClick={() => setPicker(false)}>
            <div className="brutal-lg w-full max-w-md bg-card p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 font-display text-2xl uppercase">Choose a form</div>
              <ul className="divide-y-2 divide-border border-y-2 border-border">
                {forms.map((f) => (
                  <li key={f.id}>
                    <Link
                      to="/forms/$id/fill"
                      params={{ id: f.id }}
                      search={{ patient: patient.id }}
                      className="flex flex-col px-2 py-3 hover:bg-primary/30"
                    >
                      <span className="text-sm font-bold">{f.name}</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {f.category} · {f.fields.length} fields
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button onClick={() => setPicker(false)} className="btn-brutal mt-3 w-full bg-card">
                Cancel
              </button>
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4" />
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-sm font-bold">{value}</div>
      </div>
    </div>
  );
}
