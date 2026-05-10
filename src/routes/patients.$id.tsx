import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, store, ageFromDob } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ClipboardPlus, Phone, MapPin, Calendar, Trash2, Activity } from "lucide-react";

export const Route = createFileRoute("/patients/$id")({
  component: PatientDetail,
});

function PatientDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const patient = useStore((s) => s.patients.find((p) => p.id === id));
  const submissions = useStore((s) =>
    s.submissions.filter((x) => x.patientId === id).sort((a, b) => a.createdAt - b.createdAt),
  );
  const forms = useStore((s) => s.forms);
  const [picker, setPicker] = useState(false);

  if (!patient) {
    return (
      <>
        <PageHeader title="Patient" back="/patients" />
        <PageShell>
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Patient not found.
          </div>
        </PageShell>
      </>
    );
  }

  // gather numeric trends
  const numericSeries = useMemo(() => {
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
  }, [submissions, forms]);

  const remove = () => {
    if (confirm("Delete this patient and all their visits?")) {
      store.deletePatient(patient.id);
      nav({ to: "/patients" });
    }
  };

  return (
    <>
      <PageHeader title={patient.name} back="/patients" subtitle={`${patient.sex} · ${ageFromDob(patient.dob)}`} />
      <PageShell>
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info icon={Calendar} label="DOB" value={new Date(patient.dob).toLocaleDateString()} />
            <Info icon={MapPin} label="Village" value={patient.village} />
            {patient.phone && <Info icon={Phone} label="Phone" value={patient.phone} />}
            <Info icon={Activity} label="Status" value={patient.status} />
          </div>
          {patient.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {patient.tags.map((t) => (
                <span key={t} className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setPicker(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ClipboardPlus className="h-4 w-4" /> Record visit
            </button>
            <button
              onClick={remove}
              className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"
              aria-label="Delete patient"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </section>

        {numericSeries.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Trends</h2>
            <div className="grid gap-3">
              {numericSeries.map((s) => (
                <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-1 px-1 text-xs font-medium text-foreground">{s.label}</div>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.data} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="t"
                          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          fontSize={10}
                          stroke="var(--muted-foreground)"
                        />
                        <YAxis fontSize={10} stroke="var(--muted-foreground)" domain={["auto", "auto"]} />
                        <Tooltip labelFormatter={(t) => new Date(t as number).toLocaleString()} />
                        <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h2>
          {submissions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No visits recorded yet.
            </div>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-border pl-5">
              {[...submissions].reverse().map((s) => {
                const form = forms.find((f) => f.id === s.formId);
                return (
                  <li key={s.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                    <div className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{s.formName}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(s.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {form && (
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          {form.fields.slice(0, 6).map((f) => {
                            const v = s.data[f.id];
                            if (v === undefined || v === "" || v === null) return null;
                            return (
                              <div key={f.id} className="flex justify-between gap-2">
                                <dt className="truncate text-muted-foreground">{f.label}</dt>
                                <dd className="truncate font-medium">
                                  {typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}
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
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
            onClick={() => setPicker(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-card p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-3 text-base font-semibold">Choose a form</h3>
              <ul className="divide-y divide-border">
                {forms.map((f) => (
                  <li key={f.id}>
                    <Link
                      to="/forms/$id/fill"
                      params={{ id: f.id }}
                      search={{ patient: patient.id }}
                      className="flex flex-col py-3"
                    >
                      <span className="text-sm font-medium">{f.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.category} · {f.fields.length} fields
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setPicker(false)}
                className="mt-2 w-full rounded-lg border border-border py-2 text-sm font-medium"
              >
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
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}
