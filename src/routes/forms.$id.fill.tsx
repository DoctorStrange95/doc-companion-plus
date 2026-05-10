import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useStore, store } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { AlertTriangle } from "lucide-react";

const search = z.object({ patient: z.string().optional() });

export const Route = createFileRoute("/forms/$id/fill")({
  component: FillForm,
  validateSearch: (s) => search.parse(s),
});

function FillForm() {
  const { id } = Route.useParams();
  const { patient: patientId } = Route.useSearch();
  const nav = useNavigate();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const patients = useStore((s) => s.patients);
  const [selectedPatient, setSelectedPatient] = useState(patientId ?? "");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");

  if (!form) {
    return (
      <>
        <PageHeader title="Form" back="/forms" />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p>
        </PageShell>
      </>
    );
  }

  const flags: string[] = [];
  for (const f of form.fields) {
    const v = values[f.id];
    if (f.type === "number" && v !== undefined && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) {
        const lbl = f.label.toLowerCase();
        if (lbl.includes("hemoglobin") && n < 7) flags.push("Severe anemia (Hb < 7)");
        if (lbl.includes("systolic") && n >= 140) flags.push("Elevated systolic BP");
        if (lbl.includes("diastolic") && n >= 90) flags.push("Elevated diastolic BP");
        if (lbl.includes("muac") && n < 11.5) flags.push("Severe acute malnutrition (MUAC < 11.5)");
        if (lbl.includes("temperature") && n >= 38.5) flags.push("High fever");
      }
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { setError("Please choose a patient."); return; }
    for (const f of form.fields) {
      const v = values[f.id];
      if (f.required && (v === undefined || v === "" || v === null)) { setError(`"${f.label}" is required.`); return; }
      if (f.type === "number" && v !== undefined && v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) { setError(`"${f.label}" must be a number.`); return; }
        if (f.min !== undefined && n < f.min) { setError(`"${f.label}" must be ≥ ${f.min}.`); return; }
        if (f.max !== undefined && n > f.max) { setError(`"${f.label}" must be ≤ ${f.max}.`); return; }
      }
    }
    store.addSubmission({ patientId: selectedPatient, formId: form.id, formName: form.name, data: values });
    nav({ to: "/patients/$id", params: { id: selectedPatient } });
  };

  return (
    <>
      <PageHeader title={form.name} back={patientId ? `/patients/${patientId}` : "/forms"} subtitle={form.category} variant="yellow" />
      <PageShell>
        <form onSubmit={submit} className="space-y-4">
          {!patientId && (
            <div className="brutal p-4">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Patient</label>
              <select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)} className="input-brutal">
                <option value="">Select a patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.village}</option>
                ))}
              </select>
            </div>
          )}

          <div className="brutal space-y-4 p-4">
            {form.fields.map((f) => (
              <div key={f.id}>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
                  {f.label} {f.unit && <span className="text-muted-foreground">({f.unit})</span>}
                  {f.required && <span className="ml-0.5 text-destructive">*</span>}
                </label>
                {f.type === "text" && (
                  <input value={(values[f.id] as string) ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} className="input-brutal" />
                )}
                {f.type === "textarea" && (
                  <textarea rows={3} value={(values[f.id] as string) ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} className="input-brutal resize-none" />
                )}
                {f.type === "number" && (
                  <input type="number" step="any" inputMode="decimal" value={(values[f.id] as number | string) ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value === "" ? "" : Number(e.target.value) })} className="input-brutal font-mono" />
                )}
                {f.type === "date" && (
                  <input type="date" value={(values[f.id] as string) ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} className="input-brutal" />
                )}
                {f.type === "select" && (
                  <div className="flex flex-wrap gap-1.5">
                    {(f.options ?? []).map((opt) => {
                      const active = values[f.id] === opt;
                      return (
                        <button
                          type="button"
                          key={opt}
                          onClick={() => setValues({ ...values, [f.id]: opt })}
                          className={`border-2 border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                            active ? "bg-primary" : "bg-card hover:bg-primary/30"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
                {f.type === "boolean" && (
                  <div className="grid grid-cols-2 gap-2">
                    {[{ l: "Yes", v: true }, { l: "No", v: false }].map((o) => {
                      const active = values[f.id] === o.v;
                      return (
                        <button
                          type="button"
                          key={o.l}
                          onClick={() => setValues({ ...values, [f.id]: o.v })}
                          className={`border-2 border-border py-2 text-sm font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
                        >
                          {o.l}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {flags.length > 0 && (
            <div className="brutal flex gap-3 bg-destructive p-3 text-destructive-foreground">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <div className="font-display text-lg uppercase">Clinical alert</div>
                <ul className="mt-1 space-y-0.5 text-xs font-bold uppercase tracking-wider">
                  {flags.map((f) => <li key={f}>· {f}</li>)}
                </ul>
              </div>
            </div>
          )}

          {error && <p className="text-sm font-bold uppercase tracking-wider text-destructive">{error}</p>}

          <button type="submit" className="btn-brutal w-full">Save visit</button>
        </form>
      </PageShell>
    </>
  );
}
