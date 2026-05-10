import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, store, ageFromDob } from "@/lib/store";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ClipboardPlus, Phone, MapPin, Calendar, Trash2, Activity } from "lucide-react";

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

  const numericSeries = useMemo(() => {
    if (!patient) return [];
    const byField: Record<string, { label: string; data: { t: number; v: number }[] }> = {};
    for (const s of submissions) {
      const form = forms.find((f) => f.id === s.formId);
      if (!form) continue;
      for (const f of form.fields) {
        if (f.type !== "number") continue;
        const raw = s.data[f.id];
        const v = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
        if (!Number.isFinite(v)) continue;
        const key = f.label + (f.unit ? ` (${f.unit})` : "");
        if (!byField[key]) byField[key] = { label: key, data: [] };
        byField[key].data.push({ t: s.createdAt, v });
      }
    }
    return Object.values(byField).filter((s) => s.data.length >= 2).slice(0, 4);
  }, [submissions, forms, patient]);

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

        {numericSeries.length > 0 && (
          <section className="mt-6">
            <SectionTitle kicker="Trends">Vitals</SectionTitle>
            <div className="grid gap-3">
              {numericSeries.map((s) => (
                <div key={s.label} className="brutal p-3">
                  <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-widest">{s.label}</div>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.data} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="t"
                          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          fontSize={10}
                          stroke="var(--foreground)"
                        />
                        <YAxis fontSize={10} stroke="var(--foreground)" domain={["auto", "auto"]} />
                        <Tooltip
                          labelFormatter={(t) => new Date(t as number).toLocaleString()}
                          contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 12 }}
                        />
                        <Line type="monotone" dataKey="v" stroke="var(--secondary)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--primary)", stroke: "var(--secondary)", strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
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
