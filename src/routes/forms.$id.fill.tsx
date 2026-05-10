import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useStore, store, type FormField, type VisibleIf } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { AlertTriangle, MapPin, Loader2, X } from "lucide-react";

const search = z.object({ patient: z.string().optional() });

export const Route = createFileRoute("/forms/$id/fill")({
  component: FillForm,
  validateSearch: (s) => search.parse(s),
});

interface GeoVal {
  lat: number;
  lng: number;
  accuracy?: number;
  ts: number;
}

function isFieldVisible(
  field: FormField,
  values: Record<string, unknown>,
  fields: FormField[],
): boolean {
  const vi: VisibleIf | undefined = field.visibleIf;
  if (!vi || vi.rules.length === 0) return true;
  const evalRule = (r: (typeof vi.rules)[number]): boolean => {
    const target = fields.find((f) => f.id === r.fieldId);
    if (!target) return true;
    const raw = values[r.fieldId];
    const ruleVal = r.value;
    switch (r.op) {
      case "eq":
        if (Array.isArray(raw))
          return raw.map(String).includes(String(ruleVal));
        if (typeof raw === "boolean") return String(raw) === String(ruleVal);
        return String(raw ?? "") === String(ruleVal);
      case "neq":
        if (Array.isArray(raw))
          return !raw.map(String).includes(String(ruleVal));
        if (typeof raw === "boolean") return String(raw) !== String(ruleVal);
        return String(raw ?? "") !== String(ruleVal);
      case "gt":
        return Number(raw) > Number(ruleVal);
      case "lt":
        return Number(raw) < Number(ruleVal);
      case "contains":
        if (Array.isArray(raw))
          return raw.map(String).some((v) => v.includes(String(ruleVal)));
        return String(raw ?? "").includes(String(ruleVal));
      default:
        return true;
    }
  };
  return vi.mode === "all" ? vi.rules.every(evalRule) : vi.rules.some(evalRule);
}

function FillForm() {
  const { id } = Route.useParams();
  const { patient: patientId } = Route.useSearch();
  const nav = useNavigate();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const [selectedPatient, setSelectedPatient] = useState(patientId ?? "");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [geoLoading, setGeoLoading] = useState<string | null>(null);

  const visibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => isFieldVisible(f, values, form.fields));
  }, [form, values]);

  const priorVisits = useMemo(() => {
    if (!form?.longitudinal || !selectedPatient) return [];
    return submissions
      .filter((s) => s.formId === form.id && s.patientId === selectedPatient)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [form, selectedPatient, submissions]);

  if (!form) {
    return (
      <>
        <PageHeader title="Form" back="/forms" />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Form not found
          </p>
        </PageShell>
      </>
    );
  }

  const flags: string[] = [];
  for (const f of visibleFields) {
    const v = values[f.id];
    if (f.type === "number" && v !== undefined && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) {
        const lbl = f.label.toLowerCase();
        if (lbl.includes("hemoglobin") && n < 7) flags.push("Severe anemia (Hb < 7)");
        if (lbl.includes("systolic") && n >= 140) flags.push("Elevated systolic BP");
        if (lbl.includes("diastolic") && n >= 90) flags.push("Elevated diastolic BP");
        if (lbl.includes("muac") && n < 11.5)
          flags.push("Severe acute malnutrition (MUAC < 11.5)");
        if (lbl.includes("temperature") && n >= 38.5) flags.push("High fever");
      }
    }
  }

  const captureGeo = (fieldId: string) => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported on this device.");
      return;
    }
    setGeoLoading(fieldId);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const v: GeoVal = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        };
        setValues((prev) => ({ ...prev, [fieldId]: v }));
        setGeoLoading(null);
      },
      (err) => {
        setError(`Location error: ${err.message}`);
        setGeoLoading(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Please choose a patient.");
      return;
    }
    for (const f of visibleFields) {
      const v = values[f.id];
      const empty =
        v === undefined ||
        v === "" ||
        v === null ||
        (Array.isArray(v) && v.length === 0);
      if (f.required && empty) {
        setError(`"${f.label}" is required.`);
        return;
      }
      if (f.type === "number" && v !== undefined && v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          setError(`"${f.label}" must be a number.`);
          return;
        }
        if (f.min !== undefined && n < f.min) {
          setError(`"${f.label}" must be ≥ ${f.min}.`);
          return;
        }
        if (f.max !== undefined && n > f.max) {
          setError(`"${f.label}" must be ≤ ${f.max}.`);
          return;
        }
      }
    }
    // Strip values for hidden fields so they don't pollute the submission
    const visibleIds = new Set(visibleFields.map((f) => f.id));
    const cleaned: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => {
      if (visibleIds.has(k)) cleaned[k] = v;
    });
    store.addSubmission({
      patientId: selectedPatient,
      formId: form.id,
      formName: form.name,
      data: cleaned,
    });
    nav({ to: "/patients/$id", params: { id: selectedPatient } });
  };

  return (
    <>
      <PageHeader
        title={form.name}
        back={patientId ? `/patients/${patientId}` : "/forms"}
        subtitle={form.category + (form.longitudinal ? " · Longitudinal" : "")}
        variant="yellow"
      />
      <PageShell>
        <form onSubmit={submit} className="space-y-4">
          {!patientId && (
            <div className="brutal p-4">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
                Patient
              </label>
              <select
                value={selectedPatient}
                onChange={(e) => setSelectedPatient(e.target.value)}
                data-testid="patient-select"
                className="input-brutal"
              >
                <option value="">Select a patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.village}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.longitudinal && priorVisits.length > 0 && (
            <div className="brutal-flat p-3" data-testid="prior-visits">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Prior visits ({priorVisits.length})
              </div>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {priorVisits.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="border-2 border-border bg-card px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                  >
                    {new Date(s.createdAt).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="brutal space-y-4 p-4">
            {visibleFields.map((f) => (
              <div key={f.id} data-testid={`fill-field-${f.id}`}>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
                  {f.label}{" "}
                  {f.unit && (
                    <span className="text-muted-foreground">({f.unit})</span>
                  )}
                  {f.required && (
                    <span className="ml-0.5 text-destructive">*</span>
                  )}
                </label>
                {f.type === "text" && (
                  <input
                    value={(values[f.id] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.id]: e.target.value })
                    }
                    className="input-brutal"
                  />
                )}
                {f.type === "textarea" && (
                  <textarea
                    rows={3}
                    value={(values[f.id] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.id]: e.target.value })
                    }
                    className="input-brutal resize-none"
                  />
                )}
                {f.type === "number" && (
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={(values[f.id] as number | string) ?? ""}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.id]:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                    className="input-brutal font-mono"
                  />
                )}
                {f.type === "date" && (
                  <input
                    type="date"
                    value={(values[f.id] as string) ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.id]: e.target.value })
                    }
                    className="input-brutal"
                  />
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
                {f.type === "radio" && (
                  <div className="grid gap-1.5">
                    {(f.options ?? []).map((opt) => {
                      const active = values[f.id] === opt;
                      return (
                        <label
                          key={opt}
                          className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${
                            active ? "bg-primary" : "bg-card hover:bg-primary/30"
                          }`}
                        >
                          <input
                            type="radio"
                            name={f.id}
                            checked={active}
                            onChange={() =>
                              setValues({ ...values, [f.id]: opt })
                            }
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                )}
                {f.type === "multiselect" && (
                  <div className="grid gap-1.5">
                    {(f.options ?? []).map((opt) => {
                      const arr = (values[f.id] as string[] | undefined) ?? [];
                      const active = arr.includes(opt);
                      return (
                        <label
                          key={opt}
                          className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${
                            active ? "bg-primary" : "bg-card hover:bg-primary/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...arr, opt]
                                : arr.filter((x) => x !== opt);
                              setValues({ ...values, [f.id]: next });
                            }}
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                )}
                {f.type === "boolean" && (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { l: "Yes", v: true },
                      { l: "No", v: false },
                    ].map((o) => {
                      const active = values[f.id] === o.v;
                      return (
                        <button
                          type="button"
                          key={o.l}
                          onClick={() => setValues({ ...values, [f.id]: o.v })}
                          className={`border-2 border-border py-2 text-sm font-bold uppercase tracking-wider ${
                            active ? "bg-primary" : "bg-card hover:bg-primary/30"
                          }`}
                        >
                          {o.l}
                        </button>
                      );
                    })}
                  </div>
                )}
                {f.type === "location" && (
                  <LocationField
                    value={values[f.id] as GeoVal | undefined}
                    loading={geoLoading === f.id}
                    onCapture={() => captureGeo(f.id)}
                    onClear={() =>
                      setValues((prev) => {
                        const n = { ...prev };
                        delete n[f.id];
                        return n;
                      })
                    }
                  />
                )}
              </div>
            ))}
            {visibleFields.length === 0 && (
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                No questions to show yet — answer earlier fields above.
              </p>
            )}
          </div>

          {flags.length > 0 && (
            <div className="brutal flex gap-3 bg-destructive p-3 text-destructive-foreground">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <div className="font-display text-lg uppercase">Clinical alert</div>
                <ul className="mt-1 space-y-0.5 text-xs font-bold uppercase tracking-wider">
                  {flags.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {error && (
            <p
              data-testid="form-error"
              className="text-sm font-bold uppercase tracking-wider text-destructive"
            >
              {error}
            </p>
          )}

          <button type="submit" data-testid="submit-form-btn" className="btn-brutal w-full">
            Save visit
          </button>
        </form>
      </PageShell>
    </>
  );
}

function LocationField({
  value,
  loading,
  onCapture,
  onClear,
}: {
  value: GeoVal | undefined;
  loading: boolean;
  onCapture: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onCapture}
        disabled={loading}
        className="btn-brutal flex w-full items-center justify-center gap-2 text-xs disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
        {value ? "Re-capture location" : "Capture location"}
      </button>
      {value && (
        <div className="flex items-center justify-between gap-2 border-2 border-border bg-card p-2 font-mono text-[11px]">
          <div>
            <div className="font-bold">
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </div>
            {value.accuracy && (
              <div className="text-muted-foreground">
                ± {Math.round(value.accuracy)} m
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
