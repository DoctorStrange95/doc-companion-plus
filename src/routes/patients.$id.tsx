import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, store, ageFromDob } from "@/lib/store";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ClipboardPlus, Phone, MapPin, Calendar, Trash2, Activity } from "lucide-react";
import { getWhoReference, interpolateWho } from "@/lib/who-data";

export const Route = createFileRoute("/patients/$id")({ component: PatientDetail });

function PatientDetail() {
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

  const dobMs = patient ? new Date(patient.dob).getTime() : 0;
  const sex = patient?.sex ?? "";

  // WHO growth chart data: weight-for-age and height/length-for-age
  const growthCharts = useMemo(() => {
    if (!patient) return { weight: null, height: null };

    // Collect patient's actual measurements keyed by age in months
    interface GrowthPoint {
      age: number; // months, 1 decimal
      value: number;
      date: number;
    }
    const weightPoints: GrowthPoint[] = [];
    const heightPoints: GrowthPoint[] = [];

    for (const s of submissions) {
      const form = forms.find((f) => f.id === s.formId);
      if (!form) continue;
      const ageMonths = (s.createdAt - dobMs) / (1000 * 60 * 60 * 24 * 30.4375);
      if (ageMonths < 0 || ageMonths > 60) continue;
      const ageMo = Math.round(ageMonths * 10) / 10;
      for (const f of form.fields) {
        if (f.type !== "number") continue;
        const raw = s.data[f.id];
        const v = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
        if (!Number.isFinite(v)) continue;
        const lbl = f.label.toLowerCase();
        if (lbl.includes("weight") || lbl.includes("wt") || lbl.includes("wgt")) {
          weightPoints.push({ age: ageMo, value: v, date: s.createdAt });
        } else if (lbl.includes("height") || lbl.includes("length") || lbl.includes("ht") || lbl.includes("len")) {
          heightPoints.push({ age: ageMo, value: v, date: s.createdAt });
        }
      }
    }

    const buildChart = (points: GrowthPoint[], metric: "weight" | "height") => {
      if (points.length === 0) return null;
      const ref = getWhoReference(sex, metric);
      // Only include finite-age points to avoid NaN keys in map
      const validPoints = points.filter((p) => Number.isFinite(p.age));
      if (validPoints.length === 0) return null;
      // Build reference curve at 3-month intervals across the patient's age range
      const refCurve: Array<{ age: number; sd3n: number; sd2n: number; median: number; sd2p: number; sd3p: number }> = [];
      const minAge = Math.max(0, Math.floor(Math.min(...validPoints.map((p) => p.age)) / 3) * 3 - 3);
      const maxAge = Math.min(60, Math.ceil(Math.max(...validPoints.map((p) => p.age)) / 3) * 3 + 3);
      for (let mo = minAge; mo <= maxAge; mo += 3) {
        const row = interpolateWho(ref, mo);
        if (!row) continue;
        refCurve.push({ age: mo, sd3n: row[1], sd2n: row[2], median: row[3], sd2p: row[4], sd3p: row[5] });
      }
      // Merge patient points into the dataset; use null (not undefined) so recharts skips them in domain calc
      const patientByAge = new Map(validPoints.map((p) => [p.age, p.value]));
      const allAges = Array.from(new Set([...refCurve.map((r) => r.age), ...validPoints.map((p) => p.age)])).sort((a, b) => a - b);
      const merged = allAges.map((age) => {
        const refRow = interpolateWho(ref, age);
        const refData = refRow ? { sd3n: refRow[1], sd2n: refRow[2], median: refRow[3], sd2p: refRow[4], sd3p: refRow[5] } : {};
        return { age, ...refData, child: patientByAge.get(age) ?? null };
      });
      // Compute explicit Y domain from all real reference + child values (prevents 0/-5 on height axis)
      const allVals = merged.flatMap((d) => [
        (d as Record<string, unknown>).sd3n, (d as Record<string, unknown>).sd2n, (d as Record<string, unknown>).median,
        (d as Record<string, unknown>).sd2p, (d as Record<string, unknown>).sd3p, (d as Record<string, unknown>).child,
      ]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const yMin = allVals.length > 0 ? Math.floor(Math.min(...allVals) * 0.97) : 0;
      const yMax = allVals.length > 0 ? Math.ceil(Math.max(...allVals) * 1.03) : 100;
      return { data: merged, points: validPoints, yDomain: [yMin, yMax] as [number, number] };
    };

    return {
      weight: buildChart(weightPoints, "weight"),
      height: buildChart(heightPoints, "height"),
    };
  }, [submissions, forms, patient, dobMs, sex]);

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
        <section className="brutal p-4">
          <div className="grid grid-cols-2 gap-3">
            <Info icon={Calendar} label="DOB" value={new Date(patient.dob).toLocaleDateString()} />
            <Info icon={MapPin} label="Village" value={patient.village} />
            {patient.phone && <Info icon={Phone} label="Phone" value={patient.phone} />}
            <Info icon={Activity} label="Status" value={patient.status} />
          </div>
          {patient.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {patient.tags.map((t) => (
                <span key={t} className="chip chip-yellow">{t}</span>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setPicker(true)} className="btn-brutal flex flex-1 items-center justify-center gap-1.5 text-xs">
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
        </section>

        {(growthCharts.weight || growthCharts.height) && (
          <section className="mt-6">
            <SectionTitle kicker="WHO 2006">Growth charts</SectionTitle>
            <div className="grid gap-3">
              {[
                { chart: growthCharts.weight, label: "Weight-for-age (kg)", yLabel: "kg" },
                { chart: growthCharts.height, label: "Height/Length-for-age (cm)", yLabel: "cm" },
              ].map(({ chart, label, yLabel }) =>
                chart ? (
                  <div key={label} className="brutal p-3">
                    <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest">{label}</div>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart.data} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis
                            dataKey="age"
                            tickFormatter={(v) => `${v}m`}
                            fontSize={9}
                            stroke="var(--foreground)"
                            label={{ value: "Age (months)", position: "insideBottomRight", offset: -5, fontSize: 9 }}
                          />
                          <YAxis fontSize={9} stroke="var(--foreground)" domain={chart.yDomain} unit={` ${yLabel}`} width={40} />
                          <Tooltip
                            formatter={(val: number, name: string) => {
                              const labels: Record<string, string> = { child: "Child", median: "Median", sd2n: "-2 SD", sd3n: "-3 SD", sd2p: "+2 SD", sd3p: "+3 SD" };
                              return [`${val.toFixed(1)} ${yLabel}`, labels[name] ?? name];
                            }}
                            labelFormatter={(v) => `Age: ${v} months`}
                            contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 11 }}
                          />
                          {/* WHO reference bands */}
                          <Line type="monotone" dataKey="sd3n" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd3n" />
                          <Line type="monotone" dataKey="sd2n" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd2n" />
                          <Line type="monotone" dataKey="median" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 2" dot={false} name="median" />
                          <Line type="monotone" dataKey="sd2p" stroke="#f97316" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd2p" />
                          <Line type="monotone" dataKey="sd3p" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" dot={false} name="sd3p" />
                          {/* Child's actual measurements */}
                          <Line
                            type="monotone"
                            dataKey="child"
                            stroke="var(--primary)"
                            strokeWidth={2.5}
                            dot={{ r: 7, fill: "var(--primary)", stroke: "var(--background)", strokeWidth: 2 }}
                            activeDot={{ r: 9 }}
                            connectNulls
                            name="child"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 px-1">
                      {[
                        { color: "#ef4444", label: "±3 SD" },
                        { color: "#f97316", label: "±2 SD" },
                        { color: "#22c55e", label: "Median" },
                        { color: "var(--primary)", label: "Child" },
                      ].map(({ color, label: l }) => (
                        <span key={l} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          <span className="inline-block h-2 w-4 shrink-0" style={{ backgroundColor: color }} />
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </section>
        )}

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
                              v &&
                              typeof v === "object" &&
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
                                  {display}
                                  {f.unit ? ` ${f.unit}` : ""}
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
