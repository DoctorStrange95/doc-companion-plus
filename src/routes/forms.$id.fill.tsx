import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { z } from "zod";
import { useStore, store, sync, type FormField, evaluateConditions } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { PatientPicker } from "@/components/PatientPicker";
import { AlertTriangle, MapPin, Loader2, X, Image, Upload, FileText, Trash2 } from "lucide-react";

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

interface BPVal {
  systolic: number | string;
  diastolic: number | string;
}

function isFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  // Legacy visibleIf (old skip-logic format)
  const vi = field.visibleIf;
  if (vi && vi.rules.length > 0) {
    const evalRule = (r: (typeof vi.rules)[number]): boolean => {
      const raw = values[r.fieldId];
      const rv = r.value;
      switch (r.op) {
        case "eq":
          if (Array.isArray(raw)) return raw.map(String).includes(String(rv));
          return String(raw ?? "") === String(rv);
        case "neq":
          if (Array.isArray(raw)) return !raw.map(String).includes(String(rv));
          return String(raw ?? "") !== String(rv);
        case "gt": return Number(raw) > Number(rv);
        case "lt": return Number(raw) < Number(rv);
        case "contains":
          if (Array.isArray(raw)) return raw.map(String).some((v) => v.includes(String(rv)));
          return String(raw ?? "").includes(String(rv));
        default: return true;
      }
    };
    const legacyOk = vi.mode === "all" ? vi.rules.every(evalRule) : vi.rules.some(evalRule);
    if (!legacyOk) return false;
  }
  // New ConditionalLogic format (handles both old single-rule and new multi-rule)
  return evaluateConditions(field.showIf, values);
}

function evalCalculated(formula: string, values: Record<string, unknown>, fields: FormField[]): string {
  try {
    let expr = formula;
    for (const f of fields) {
      const varName = f.variableName ?? f.id;
      const val = Number(values[f.id]);
      if (Number.isFinite(val)) {
        expr = expr.replace(new RegExp(`\\b${varName}\\b`, "g"), String(val));
      }
    }
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expr})`)();
    const n = Number(result);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—";
  } catch {
    return "—";
  }
}

function getFieldOptions(f: FormField): { label: string; value: string }[] {
  if (f.optionObjects && f.optionObjects.length > 0) return f.optionObjects;
  return (f.options ?? []).map((o) => ({ label: o, value: o }));
}

function FillForm() {
  const { id } = Route.useParams();
  const { patient: patientId } = Route.useSearch();
  const nav = useNavigate();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const submissions = useStore((s) => s.submissions);
  const [selectedPatient, setSelectedPatient] = useState(patientId ?? "");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [geoLoading, setGeoLoading] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Always fetch the latest form definition so data collectors see owner's updates
  useEffect(() => { void sync.pull(); }, []);

  const set = (fieldId: string, val: unknown) =>
    setValues((prev) => ({ ...prev, [fieldId]: val }));

  const allVisibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => isFieldVisible(f, values));
  }, [form, values]);

  // Split visible fields into pages at page_break markers
  const pages = useMemo(() => {
    const result: FormField[][] = [[]];
    for (const f of allVisibleFields) {
      if (f.type === "page_break") {
        result.push([]);
      } else {
        result[result.length - 1].push(f);
      }
    }
    return result;
  }, [allVisibleFields]);

  const visibleFields = pages[page] ?? [];
  const isLastPage = page >= pages.length - 1;

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
  for (const f of allVisibleFields) {
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
        if (f.normalRange && (n < f.normalRange.min || n > f.normalRange.max)) {
          flags.push(`${f.label} out of range (${f.normalRange.min}–${f.normalRange.max} ${f.unit ?? ""})`);
        }
      }
    }
    if (f.type === "measurement" && f.measurementType === "BP") {
      const bp = v as BPVal | undefined;
      if (bp?.systolic !== undefined && Number(bp.systolic) >= 140) flags.push("Elevated systolic BP");
      if (bp?.diastolic !== undefined && Number(bp.diastolic) >= 90) flags.push("Elevated diastolic BP");
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
        set(fieldId, {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        } satisfies GeoVal);
        setGeoLoading(null);
      },
      (err) => {
        setError(`Location error: ${err.message}`);
        setGeoLoading(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const validatePage = (): string | null => {
    for (const f of visibleFields) {
      if (f.type === "section_header" || f.type === "calculated") continue;
      const v = values[f.id];
      const empty =
        v === undefined || v === "" || v === null ||
        (Array.isArray(v) && v.length === 0);
      if (f.required && empty) return `"${f.label}" is required.`;
      if (f.type === "number" && v !== undefined && v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) return `"${f.label}" must be a number.`;
        if (f.min !== undefined && n < f.min) return `"${f.label}" must be ≥ ${f.min}.`;
        if (f.max !== undefined && n > f.max) return `"${f.label}" must be ≤ ${f.max}.`;
      }
    }
    return null;
  };

  const handleNext = () => {
    const err = validatePage();
    if (err) { setError(err); return; }
    setError("");
    setPage((p) => p + 1);
    window.scrollTo(0, 0);
  };

  // Only longitudinal forms (or forms opened from a patient profile) need a patient linked
  const needsPatient = form.longitudinal || !!patientId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsPatient && !selectedPatient) { setError("Please choose a patient."); return; }
    const err = validatePage();
    if (err) { setError(err); return; }
    const visibleIds = new Set(allVisibleFields.map((f) => f.id));
    const cleaned: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => {
      if (visibleIds.has(k)) cleaned[k] = v;
    });
    store.addSubmission({
      patientId: selectedPatient || "",
      formId: form.id,
      formName: form.name,
      data: cleaned,
    });
    if (selectedPatient) {
      nav({ to: "/patients/$id", params: { id: selectedPatient } });
    } else {
      nav({ to: "/forms" });
    }
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
          {needsPatient && !patientId && (
            <div className="brutal p-4">
              <PatientPicker
                value={selectedPatient}
                onChange={(pid) => setSelectedPatient(pid)}
              />
            </div>
          )}

          {pages.length > 1 && (
            <div className="flex items-center gap-1">
              {pages.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 border border-border ${i <= page ? "bg-primary" : "bg-muted"}`}
                />
              ))}
              <span className="ml-2 shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {page + 1}/{pages.length}
              </span>
            </div>
          )}

          {form.longitudinal && priorVisits.length > 0 && page === 0 && (
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
              <FieldRenderer
                key={f.id}
                field={f}
                value={values[f.id]}
                values={values}
                allFields={form.fields}
                geoLoading={geoLoading}
                onChange={(v) => set(f.id, v)}
                onGeo={() => captureGeo(f.id)}
                onGeoClear={() =>
                  setValues((prev) => {
                    const n = { ...prev };
                    delete n[f.id];
                    return n;
                  })
                }
              />
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
                  {flags.map((flag) => (
                    <li key={flag}>· {flag}</li>
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

          {isLastPage ? (
            <button type="submit" data-testid="submit-form-btn" className="btn-brutal w-full">
              Save visit
            </button>
          ) : (
            <button type="button" onClick={handleNext} className="btn-brutal w-full">
              Next →
            </button>
          )}
        </form>
      </PageShell>
    </>
  );
}

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  values: Record<string, unknown>;
  allFields: FormField[];
  geoLoading: string | null;
  onChange: (v: unknown) => void;
  onGeo: () => void;
  onGeoClear: () => void;
}

function FieldRenderer({
  field: f,
  value,
  values,
  allFields,
  geoLoading,
  onChange,
  onGeo,
  onGeoClear,
}: FieldRendererProps) {
  const opts = getFieldOptions(f);

  if (f.type === "section_header") {
    return (
      <div className="border-b-2 border-border pb-2 pt-4">
        <div className="font-display text-base uppercase tracking-widest">{f.label}</div>
        {f.hint && <p className="mt-0.5 text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  }

  return (
    <div data-testid={`fill-field-${f.id}`}>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
        {f.label}
        {f.unit && <span className="text-muted-foreground"> ({f.unit})</span>}
        {f.required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {f.hint && <p className="mb-1.5 text-[11px] text-muted-foreground">{f.hint}</p>}

      {/* Short text / legacy text */}
      {(f.type === "short_text" || f.type === "text") && (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal"
        />
      )}

      {/* Long text / legacy textarea */}
      {(f.type === "long_text" || f.type === "textarea") && (
        <textarea
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal resize-none"
        />
      )}

      {/* Number */}
      {f.type === "number" && (
        <input
          type="number"
          step={f.decimalPlaces !== undefined ? String(Math.pow(10, -f.decimalPlaces)) : "any"}
          inputMode="decimal"
          min={f.min}
          max={f.max}
          value={(value as number | string) ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="input-brutal font-mono"
        />
      )}

      {/* Date */}
      {f.type === "date" && (
        <input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal"
        />
      )}

      {/* Time */}
      {f.type === "time" && (
        <input
          type="time"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal"
        />
      )}

      {/* Datetime */}
      {f.type === "datetime" && (
        <input
          type="datetime-local"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal"
        />
      )}

      {/* Select one / legacy select / legacy radio */}
      {(f.type === "select_one" || f.type === "select" || f.type === "radio") && (
        f.displayAs === "dropdown" ? (
          <select
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="input-brutal"
          >
            <option value="">— select —</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <div className="grid gap-1.5">
            {opts.map((o) => {
              const active = value === o.value;
              return (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
                >
                  <input
                    type="radio"
                    name={f.id}
                    checked={active}
                    onChange={() => onChange(o.value)}
                    className="sr-only"
                  />
                  {o.label}
                </label>
              );
            })}
            {f.includeOther && (
              <label
                className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${value === "__other__" ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
              >
                <input
                  type="radio"
                  name={f.id}
                  checked={value === "__other__"}
                  onChange={() => onChange("__other__")}
                  className="sr-only"
                />
                Other
              </label>
            )}
          </div>
        )
      )}

      {/* Select many / legacy multiselect */}
      {(f.type === "select_many" || f.type === "multiselect") && (
        <div className="grid gap-1.5">
          {opts.map((o) => {
            const arr = (value as string[] | undefined) ?? [];
            const active = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arr, o.value]
                      : arr.filter((x) => x !== o.value);
                    onChange(next);
                  }}
                  className="sr-only"
                />
                {o.label}
              </label>
            );
          })}
        </div>
      )}

      {/* Yes / No / legacy boolean */}
      {(f.type === "yes_no" || f.type === "boolean") && (
        <div className="grid grid-cols-2 gap-2">
          {([{ l: "Yes", v: true }, { l: "No", v: false }] as const).map((o) => {
            const active = value === o.v;
            return (
              <button
                type="button"
                key={o.l}
                onClick={() => onChange(o.v)}
                className={`border-2 border-border py-3 text-sm font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
              >
                {o.l}
              </button>
            );
          })}
        </div>
      )}

      {/* Slider */}
      {f.type === "slider" && (
        <SliderField field={f} value={value as number | undefined} onChange={onChange} />
      )}

      {/* Rating */}
      {f.type === "rating" && (
        <RatingField field={f} value={value as number | undefined} onChange={onChange} />
      )}

      {/* Calculated — read-only */}
      {f.type === "calculated" && (
        <div className="input-brutal flex items-center justify-between bg-muted">
          <span className="font-mono text-lg">
            {f.formula ? evalCalculated(f.formula, values, allFields) : "—"}
          </span>
          {f.unit && <span className="text-sm font-bold text-muted-foreground">{f.unit}</span>}
        </div>
      )}

      {/* Matrix */}
      {f.type === "matrix" && (
        <MatrixField
          field={f}
          value={value as Record<string, string> | undefined}
          onChange={onChange}
        />
      )}

      {/* Measurement */}
      {f.type === "measurement" && (
        <MeasurementField field={f} value={value} onChange={onChange} />
      )}

      {/* Location */}
      {f.type === "location" && (
        <LocationField
          value={value as GeoVal | undefined}
          loading={geoLoading === f.id}
          onCapture={onGeo}
          onClear={onGeoClear}
        />
      )}

      {/* Photo */}
      {f.type === "photo" && (
        <PhotoField value={value as string | undefined} onChange={onChange} />
      )}
      {f.type === "file_upload" && (
        <FileUploadField field={f} value={value as FileUploadValue | undefined} onChange={onChange} />
      )}
    </div>
  );
}

function SliderField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: number | undefined;
  onChange: (v: unknown) => void;
}) {
  const min = field.sliderMin ?? 0;
  const max = field.sliderMax ?? 100;
  const step = field.sliderStep ?? 1;
  const current = value ?? min;
  return (
    <div className="space-y-1">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>{field.leftLabel ?? String(min)}</span>
        {field.showValue !== false && (
          <span className="text-foreground">
            {current}
            {field.unit ? ` ${field.unit}` : ""}
          </span>
        )}
        <span>{field.rightLabel ?? String(max)}</span>
      </div>
    </div>
  );
}

function RatingField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: number | undefined;
  onChange: (v: unknown) => void;
}) {
  const max = field.maxRating ?? 5;
  const isStars = field.ratingType !== "numbers";
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = value !== undefined && n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`min-w-[2rem] border-2 border-border px-2 py-1 text-sm font-bold transition-colors ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
          >
            {isStars ? (active ? "★" : "☆") : String(n)}
          </button>
        );
      })}
    </div>
  );
}

function MatrixField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: Record<string, string> | undefined;
  onChange: (v: unknown) => void;
}) {
  const rows = field.matrixRows ?? [];
  const cols = field.matrixColumns ?? [];
  const current = value ?? {};
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border-2 border-border px-2 py-1 text-left font-bold uppercase tracking-wider" />
            {cols.map((col) => (
              <th
                key={col}
                className="border-2 border-border px-2 py-1 text-center font-bold uppercase tracking-wider"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="border-2 border-border px-2 py-1 font-bold">{row}</td>
              {cols.map((col) => (
                <td key={col} className="border-2 border-border px-2 py-1 text-center">
                  <input
                    type="radio"
                    name={`${field.id}_${row}`}
                    checked={current[row] === col}
                    onChange={() => onChange({ ...current, [row]: col })}
                    className="accent-primary"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MeasurementField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.measurementType === "BP") {
    const bp = (value as BPVal | undefined) ?? { systolic: "", diastolic: "" };
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Systolic
          </label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="120"
            value={bp.systolic}
            onChange={(e) =>
              onChange({
                ...bp,
                systolic: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            className="input-brutal font-mono"
          />
        </div>
        <div className="mb-2 text-xl font-bold">/</div>
        <div className="flex-1">
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Diastolic
          </label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="80"
            value={bp.diastolic}
            onChange={(e) =>
              onChange({
                ...bp,
                diastolic: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            className="input-brutal font-mono"
          />
        </div>
        <div className="mb-2 text-xs font-bold text-muted-foreground">mmHg</div>
      </div>
    );
  }

  const unitMap: Record<string, string> = {
    temperature: "°C",
    SpO2: "%",
    BSL: "mg/dL",
    MUAC: "cm",
    weight: "kg",
    height: "cm",
  };
  const unit = field.unit ?? (field.measurementType ? (unitMap[field.measurementType] ?? "") : "");
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={(value as number | string) ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="input-brutal flex-1 font-mono"
      />
      {unit && <span className="text-sm font-bold text-muted-foreground">{unit}</span>}
    </div>
  );
}

function PhotoField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="btn-brutal flex w-full cursor-pointer items-center justify-center gap-2 text-xs">
        <Image className="h-4 w-4" />
        {value ? "Replace photo" : "Take / upload photo"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => onChange(reader.result as string);
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {value && (
        <div className="relative">
          <img
            src={value}
            alt="Captured"
            className="w-full border-2 border-border object-contain"
            style={{ maxHeight: 200 }}
          />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute right-1 top-1 border-2 border-border bg-card p-1 hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

interface FileUploadValue {
  name: string;
  size: number;
  type: string;
  data: string; // base64 data URL
}

function FileUploadField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: FileUploadValue | undefined;
  onChange: (v: unknown) => void;
}) {
  const maxBytes = (field.maxSizeMB ?? 5) * 1024 * 1024;
  const accept = field.acceptTypes && field.acceptTypes !== "*" ? field.acceptTypes : undefined;
  const [error, setError] = useState("");

  function handleFile(file: File) {
    setError("");
    if (file.size > maxBytes) {
      setError(`File is too large. Maximum size is ${field.maxSizeMB ?? 5} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        name: file.name,
        size: file.size,
        type: file.type,
        data: reader.result as string,
      } satisfies FileUploadValue);
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (value) {
    const kb = (value.size / 1024).toFixed(0);
    const mb = (value.size / (1024 * 1024)).toFixed(2);
    const sizeLabel = value.size > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
    return (
      <div className="flex items-center gap-3 border-2 border-primary bg-primary/5 px-3 py-3">
        <FileText className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold">{value.name}</div>
          <div className="text-[10px] text-muted-foreground">{sizeLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => { onChange(undefined); setError(""); }}
          className="shrink-0 border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
          title="Remove file"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label
        className="flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-border px-4 py-6 text-center hover:border-primary hover:bg-primary/5 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Click to upload or drag & drop
        </div>
        <div className="text-[10px] text-muted-foreground">
          {accept ? accept.replace(/,/g, ", ") : "Any file"} · max {field.maxSizeMB ?? 5} MB
        </div>
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}
    </div>
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
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        {value ? "Re-capture location" : "Capture location"}
      </button>
      {value && (
        <div className="flex items-center justify-between gap-2 border-2 border-border bg-card p-2 font-mono text-[11px]">
          <div>
            <div className="font-bold">
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </div>
            {value.accuracy && (
              <div className="text-muted-foreground">± {Math.round(value.accuracy)} m</div>
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
