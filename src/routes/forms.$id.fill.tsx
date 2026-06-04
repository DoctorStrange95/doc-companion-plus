import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useStore, store, sync, type FormField, evaluateConditions } from "@/lib/store";
import type { LongitudinalSubmission } from "@/types/longitudinal";
import { PageHeader, PageShell } from "@/components/PageShell";
import { PatientPicker } from "@/components/PatientPicker";
import { AlertTriangle, MapPin, Loader2, X, Image, Upload, FileText, Trash2, Search, ChevronDown, ChevronUp, Scale, TrendingUp, Pill, Timer } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { EmbeddedBMI } from "@/components/tools/EmbeddedBMI";
import { EmbeddedGrowthChart } from "@/components/tools/EmbeddedGrowthChart";
import { EmbeddedDrugReference } from "@/components/tools/EmbeddedDrugReference";
import { GpsTrackField, type GpsTrackData } from "@/components/fields/GpsTrackField";

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
  const longitudinalSubmissions = useStore((s) => s.longitudinalSubmissions);
  const [selectedPatient, setSelectedPatient] = useState(patientId ?? "");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [geoLoading, setGeoLoading] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showDraftBanner, setShowDraftBanner] = useState(false);

  // Longitudinal subject picker state
  type SubjectState = { mode: 'new' } | { mode: 'selected'; sub: LongitudinalSubmission };
  const [subjectState, setSubjectState] = useState<SubjectState>({ mode: 'new' });
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectResults, setSubjectResults] = useState<LongitudinalSubmission[]>([]);

  // ── Fill draft cache ─────────────────────────────────────────────────────────
  // Values entered while filling a form are cached in localStorage so that a
  // browser refresh or accidental navigation never loses in-progress work.
  // The cache is cleared automatically when the form is submitted.
  const fillDraftKey = `fill_draft_${id}`;

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(fillDraftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        values?: Record<string, unknown>;
        page?: number;
        selectedPatient?: string;
      };
      if (d.values && Object.keys(d.values).length > 0) {
        setValues(d.values);
        setShowDraftBanner(true);
      }
      if (typeof d.page === "number" && d.page > 0) setPage(d.page);
      if (d.selectedPatient) setSelectedPatient(d.selectedPatient);
    } catch { /* corrupt cache — ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Auto-save draft on every change
  useEffect(() => {
    if (Object.keys(values).length === 0 && !selectedPatient) return;
    try {
      localStorage.setItem(fillDraftKey, JSON.stringify({ values, page, selectedPatient }));
    } catch { /* storage quota — silently skip */ }
  }, [values, page, selectedPatient, fillDraftKey]);

  // Pull on mount to get the latest form definition before the user starts filling.
  // Background refreshes are handled by the store's own 30s sync interval.
  useEffect(() => {
    void sync.pull();
  }, []);

  // Longitudinal subject search — local store + server
  useEffect(() => {
    if (!form?.longitudinal || !subjectSearch.trim()) { setSubjectResults([]); return; }
    const q = subjectSearch.trim().toLowerCase();
    const localMatches = longitudinalSubmissions
      .filter(s => s.formId === id)
      .filter(s => Object.values(s.fixedData).some(v => String(v).toLowerCase().includes(q)));
    if (form.shareToken) {
      const ctrl = new AbortController();
      fetch(`${API_BASE}/api/forms/public/${form.shareToken}/subjects?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : [])
        .then((serverResults: LongitudinalSubmission[]) => {
          const map = new Map<string, LongitudinalSubmission>();
          for (const s of localMatches) map.set(s.id, s);
          for (const s of serverResults) map.set(s.id, s);
          setSubjectResults([...map.values()].slice(0, 10));
        })
        .catch(() => setSubjectResults(localMatches.slice(0, 10)));
      return () => ctrl.abort();
    }
    setSubjectResults(localMatches.slice(0, 10));
  }, [subjectSearch, longitudinalSubmissions, form, id]);

  const handleSubjectSelect = (sub: LongitudinalSubmission) => {
    setSubjectState({ mode: 'selected', sub });
    const fixedIds = form?.fields.filter(f => f.longitudinalRole === 'fixed').map(f => f.id) ?? [];
    const newVals: Record<string, unknown> = {};
    fixedIds.forEach(fid => { newVals[fid] = sub.fixedData[fid]; });
    setValues(newVals);
    setSubjectSearch('');
    setSubjectResults([]);
  };

  const clearSubject = () => {
    setSubjectState({ mode: 'new' });
    setValues({});
    setSubjectSearch('');
  };

  const set = (fieldId: string, val: unknown) =>
    setValues((prev) => ({ ...prev, [fieldId]: val }));

  const fixedFieldIds = useMemo(() => {
    if (!form?.longitudinal) return [];
    if (form.fixedFieldIds && form.fixedFieldIds.length > 0) return form.fixedFieldIds;
    return form.fields.filter((f) => f.longitudinalRole === 'fixed').map((f) => f.id);
  }, [form]);

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

  if (form.status === "closed") {
    return (
      <>
        <PageHeader title={form.name} back="/forms" />
        <PageShell>
          <div className="text-center space-y-2 py-8">
            <p className="font-display text-xl uppercase tracking-widest">Responses Closed</p>
            <p className="text-sm text-muted-foreground">
              This form is no longer accepting responses.
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  if (form.status === "draft") {
    return (
      <>
        <PageHeader title={form.name} back="/forms" />
        <PageShell>
          <div className="text-center space-y-2 py-8">
            <p className="font-display text-xl uppercase tracking-widest">Not Yet Published</p>
            <p className="text-sm text-muted-foreground">
              This form is in draft mode and is not yet accepting responses.
            </p>
          </div>
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
      if (f.type === "section_header" || f.type === "calculated" || f.type === "tool_embed") continue;
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

  // Only non-longitudinal forms opened from a patient profile need a patient linked
  const needsPatient = !form.longitudinal && !!patientId;

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
    try { localStorage.removeItem(fillDraftKey); } catch { /* ignore */ }

    if (form.longitudinal) {
      store.submitLongitudinalVisit(form.id, cleaned, {
        id: form.id,
        name: form.name,
        category: form.category,
        fields: form.fields,
        createdAt: form.createdAt,
        longitudinal: true,
        fixedFieldIds: form.fixedFieldIds ?? form.fields.filter(f => f.longitudinalRole === 'fixed').map(f => f.id),
      });
      void sync.drain();
      nav({ to: "/forms/$id", params: { id: form.id } });
      return;
    }

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
        {showDraftBanner && (
          <div className="flex items-center justify-between gap-2 border-2 border-border bg-primary/20 px-4 py-2 mb-2">
            <span className="text-[11px] font-bold">
              Resuming from where you left off.
            </span>
            <button
              type="button"
              onClick={() => {
                try { localStorage.removeItem(fillDraftKey); } catch { /* ignore */ }
                setValues({});
                setPage(0);
                setSelectedPatient(patientId ?? "");
                setShowDraftBanner(false);
              }}
              className="shrink-0 border-2 border-border bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest hover:bg-muted"
            >
              Start fresh
            </button>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          {/* Longitudinal subject picker */}
          {form.longitudinal && (
            <div className="brutal p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Subject tracking
              </div>
              {subjectState.mode === 'selected' ? (
                <div className="flex items-center justify-between gap-2 border-2 border-primary bg-primary/10 px-3 py-2">
                  <div>
                    <div className="text-sm font-bold">
                      {Object.values(subjectState.sub.fixedData).filter(Boolean).join(' · ') || 'Subject'}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                      {subjectState.sub.visits.length} previous visit{subjectState.sub.visits.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button type="button" onClick={clearSubject} className="border border-border p-1 hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      className="input-brutal w-full pl-8 text-sm"
                      placeholder="Search existing subject…"
                      value={subjectSearch}
                      onChange={e => setSubjectSearch(e.target.value)}
                    />
                  </div>
                  {subjectResults.length > 0 && (
                    <ul className="brutal-flat mt-1 divide-y divide-border">
                      {subjectResults.map(sub => (
                        <li key={sub.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-primary/20 text-sm"
                            onClick={() => handleSubjectSelect(sub)}
                          >
                            <span className="font-bold">{Object.values(sub.fixedData).filter(Boolean).join(' · ')}</span>
                            <span className="ml-2 text-[10px] text-muted-foreground">{sub.visits.length} visit{sub.visits.length !== 1 ? 's' : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {subjectSearch.trim() && subjectResults.length === 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground px-1">No existing subject — fill in fields below to create new</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Patient picker for non-longitudinal forms opened from patient profile */}
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
            {visibleFields.map((f) => {
              const isFixedLocked = form.longitudinal && subjectState.mode === 'selected' && fixedFieldIds.includes(f.id);
              return (
                <FieldRenderer
                  key={f.id}
                  field={f}
                  value={values[f.id]}
                  values={values}
                  allFields={form.fields}
                  geoLoading={geoLoading}
                  readOnly={isFixedLocked}
                  onChange={(v) => set(f.id, v)}
                  onGeo={() => captureGeo(f.id)}
                  onGeoClear={() =>
                    setValues((prev) => {
                      const n = { ...prev };
                      delete n[f.id];
                      return n;
                    })
                  }
                  onWriteBack={(fieldId, val) => set(fieldId, val)}
                />
              );
            })}
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

interface ToolEmbedFieldProps {
  field: FormField;
  values: Record<string, unknown>;
  allFields: FormField[];
  onChange: (val: unknown) => void;
  onWriteBack: (fieldId: string, val: unknown) => void;
}

interface AgeValue {
  value: number | string;
  unit: "years" | "months" | "days";
}

function ToolEmbedField({ field, values, allFields, onChange, onWriteBack }: ToolEmbedFieldProps) {
  const [open, setOpen] = useState(false);
  const toolId = field.toolId ?? "bmi";

  // Read source field values from current form values
  const srcWeight = field.weightFieldId ? Number(values[field.weightFieldId]) || undefined : undefined;
  const srcHeight = field.heightFieldId ? Number(values[field.heightFieldId]) || undefined : undefined;
  const srcSexRaw = field.sexFieldId    ? String(values[field.sexFieldId] ?? "") : "";
  const srcSex    = srcSexRaw.toLowerCase().includes("f") ? "F" : srcSexRaw ? "M" : "";

  // Age field: may be an `age` type field (has value + unit) or a plain number field
  const ageRawVal = field.ageFieldId ? values[field.ageFieldId] : undefined;
  const ageField  = field.ageFieldId ? allFields.find((f) => f.id === field.ageFieldId) : undefined;
  let ageMonthsFromField: number | undefined;
  let ageYearsFromField: number | undefined;
  if (ageRawVal !== undefined && ageRawVal !== null && ageRawVal !== "") {
    if (ageField?.type === "age" && typeof ageRawVal === "object") {
      const av = ageRawVal as { value: number; unit: "years" | "months" | "days" };
      const months = av.unit === "years" ? av.value * 12 : av.unit === "days" ? av.value / 30.44 : av.value;
      ageMonthsFromField = Math.round(months * 10) / 10;
      ageYearsFromField  = months / 12;
    } else {
      // Plain number field — assume unit from ageField.ageUnit or fallback to years
      const raw = Number(ageRawVal);
      if (Number.isFinite(raw)) {
        const unit = ageField?.ageUnit ?? "years";
        ageMonthsFromField = unit === "years" ? raw * 12 : unit === "days" ? raw / 30.44 : raw;
        ageYearsFromField  = ageMonthsFromField / 12;
      }
    }
  }

  // For BMI: pass age in years; for growth: pass age in months
  const srcAgeYears  = ageYearsFromField;
  const srcAgeMonths = ageMonthsFromField;

  // Age routing: Growth Chart for 0–60 months, BMI (WHO 2007 or adult) for ≥61 months
  const ageRouting: "growth" | "bmi" | null = (() => {
    if (ageMonthsFromField === undefined) return null;
    return ageMonthsFromField < 61 ? "growth" : "bmi";
  })();

  // Block rules
  const bmiBlocked    = ageRouting === "growth"; // < 5 years → no BMI (use Growth Chart)
  const growthBlocked = ageRouting === "bmi";    // ≥ 5 years → Growth Chart data only for 0-5

  // Auto mode: source fields are linked
  const hasSourceFields = !!(field.weightFieldId || field.heightFieldId || field.ageFieldId || field.sexFieldId);

  // Write result both to own field value AND to optional writeBackFieldId
  const handleResult = (val: unknown) => {
    onChange(val); // always save to the tool field itself
    if (field.writeBackFieldId) onWriteBack(field.writeBackFieldId, val);
  };

  // AUTO MODE: inline result, no expand button needed
  if (hasSourceFields && toolId !== "drug_reference") {
    if (toolId === "bmi" && bmiBlocked) {
      return (
        <div className="flex items-center gap-2 border-2 border-border bg-muted/30 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0" />
          BMI — use Growth Chart for age &lt; 5 years
        </div>
      );
    }
    if (toolId === "growth" && growthBlocked) {
      return (
        <div className="flex items-center gap-2 border-2 border-border bg-muted/30 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 shrink-0" />
          Growth Chart — WHO 0–60 months only. Use BMI-for-age for ≥ 5 years.
        </div>
      );
    }

    return (
      <div data-testid={`fill-field-${field.id}`}>
        {toolId === "bmi" && (
          <EmbeddedBMI
            autoMode
            initialWeight={srcWeight}
            initialHeight={srcHeight}
            initialSex={srcSex}
            initialAgeMonths={srcAgeMonths}
            onResult={handleResult}
          />
        )}
        {toolId === "growth" && (
          <EmbeddedGrowthChart
            autoMode
            initialWeight={srcWeight}
            initialHeight={srcHeight}
            initialAgeMonths={srcAgeMonths}
            initialSex={srcSex}
            onResult={(r) => handleResult({ waz: r.waz, haz: r.haz, whz: r.whz, status: r.label })}
          />
        )}
      </div>
    );
  }

  // MANUAL MODE: expandable panel (no source fields linked)
  const toolLabels: Record<string, string> = { bmi: "BMI Calculator", growth: "Growth Chart", drug_reference: "Drug Reference" };
  const toolIcons: Record<string, React.ComponentType<{ className?: string }>> = { bmi: Scale, growth: TrendingUp, drug_reference: Pill };
  const TIcon = toolIcons[toolId] ?? Scale;
  const label = field.label || toolLabels[toolId] || "Clinical Tool";

  return (
    <div className="border-2 border-primary/40 bg-primary/5" data-testid={`fill-field-${field.id}`}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <TIcon className="h-4 w-4 text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">{label}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
      </button>

      {open && (
        <div className="border-t-2 border-primary/20 p-4">
          {toolId === "bmi" && (
            <EmbeddedBMI
              onResult={handleResult}
              initialAgeMonths={srcAgeMonths}
            />
          )}
          {toolId === "growth" && (
            <EmbeddedGrowthChart
              onResult={(r) => handleResult({ waz: r.waz, haz: r.haz, whz: r.whz, status: r.label })}
            />
          )}
          {toolId === "drug_reference" && <EmbeddedDrugReference />}
        </div>
      )}
    </div>
  );
}

interface FieldRendererProps {
  field: FormField;
  value: unknown;
  values: Record<string, unknown>;
  allFields: FormField[];
  geoLoading: string | null;
  readOnly?: boolean;
  onChange: (v: unknown) => void;
  onGeo: () => void;
  onGeoClear: () => void;
  onWriteBack?: (fieldId: string, val: unknown) => void;
}

function FieldRenderer({
  field: f,
  value,
  values,
  allFields,
  geoLoading,
  readOnly,
  onChange,
  onGeo,
  onGeoClear,
  onWriteBack,
}: FieldRendererProps) {
  const opts = getFieldOptions(f);

  if (f.type === "tool_embed") {
    return (
      <ToolEmbedField
        field={f}
        values={values}
        allFields={allFields}
        onChange={(v) => onChange(v)}
        onWriteBack={(fieldId, val) => onWriteBack?.(fieldId, val)}
      />
    );
  }

  if (f.type === "age") {
    return (
      <div data-testid={`fill-field-${f.id}`}>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
          {f.label}
          {f.required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        {f.hint && <p className="mb-1.5 text-[11px] text-muted-foreground">{f.hint}</p>}
        <AgeField field={f} value={value as AgeValue | undefined} onChange={onChange} />
      </div>
    );
  }

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
        {readOnly && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-widest border border-muted-foreground px-1 py-0.5 text-muted-foreground">fixed</span>}
      </label>
      {f.hint && <p className="mb-1.5 text-[11px] text-muted-foreground">{f.hint}</p>}

      {/* Short text / legacy text */}
      {(f.type === "short_text" || f.type === "text") && (
        <input
          value={(value as string) ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`input-brutal${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
        />
      )}

      {/* Long text / legacy textarea */}
      {(f.type === "long_text" || f.type === "textarea") && (
        <textarea
          rows={3}
          value={(value as string) ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`input-brutal resize-none${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
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
          readOnly={readOnly}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`input-brutal font-mono${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
        />
      )}

      {/* Date */}
      {f.type === "date" && (
        <input
          type="date"
          value={(value as string) ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`input-brutal${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
        />
      )}

      {/* Time */}
      {f.type === "time" && (
        <input
          type="time"
          value={(value as string) ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`input-brutal${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
        />
      )}

      {/* Datetime */}
      {f.type === "datetime" && (
        <input
          type="datetime-local"
          value={(value as string) ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`input-brutal${readOnly ? " opacity-60 cursor-not-allowed" : ""}`}
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

      {/* GPS Area Mapping */}
      {f.type === "gps_track" && (
        <GpsTrackField
          value={value as GpsTrackData | undefined}
          onChange={onChange}
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
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(reader.result as string);
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn-brutal flex w-full items-center justify-center gap-2 text-xs"
        onClick={() => inputRef.current?.click()}
      >
        <Image className="h-4 w-4" />
        {value ? "Replace photo" : "Take / upload photo"}
      </button>
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
  const inputRef = useRef<HTMLInputElement>(null);
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
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <div
        className="flex flex-col items-center gap-2 border-2 border-dashed border-border px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Drag & drop here, or
        </div>
        <button
          type="button"
          className="btn-brutal px-4 py-2 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </button>
        <div className="text-[10px] text-muted-foreground">
          {accept ? accept.replace(/,/g, ", ") : "Any file"} · max {field.maxSizeMB ?? 5} MB
        </div>
      </div>
      {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}
    </div>
  );
}

function AgeField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: AgeValue | undefined;
  onChange: (v: unknown) => void;
}) {
  const unit = value?.unit ?? field.ageUnit ?? "years";
  const num  = value?.value ?? "";

  const update = (newNum: string | number, newUnit: "years" | "months" | "days") => {
    onChange({ value: newNum, unit: newUnit });
  };

  // Compute display hint: convert to other units for context
  const numVal = Number(num);
  let hint = "";
  if (Number.isFinite(numVal) && numVal > 0) {
    if (unit === "years") {
      const months = Math.round(numVal * 12);
      hint = `≈ ${months} months`;
      if (numVal < 5)  hint += " — Growth Chart range";
      else if (numVal < 18) hint += " — intermediate (5–17 yrs)";
      else hint += " — BMI range (≥ 18 yrs)";
    } else if (unit === "months") {
      const years = (numVal / 12).toFixed(1);
      hint = `≈ ${years} years`;
      if (numVal < 60)  hint += " — Growth Chart range (< 5 yrs)";
      else if (numVal < 216) hint += " — intermediate";
      else hint += " — BMI range (≥ 18 yrs)";
    } else if (unit === "days") {
      const months = Math.round(numVal / 30.44);
      const years  = (numVal / 365.25).toFixed(1);
      hint = `≈ ${months} months / ${years} years`;
      if (numVal < 1826) hint += " — Growth Chart range";
      else hint += " — BMI range";
    }
  }

  // Colour the hint based on routing
  const hintIsGrowth = hint.includes("Growth Chart");
  const hintIsBMI    = hint.includes("BMI range");
  const hintIsInter  = hint.includes("intermediate");
  const hintCls = hintIsGrowth ? "text-green-600 font-bold" : hintIsBMI ? "text-blue-600 font-bold" : hintIsInter ? "text-amber-600" : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={num as string}
          onChange={(e) => update(e.target.value, unit)}
          className="input-brutal flex-1 font-mono text-lg"
          placeholder="0"
        />
        <div className="grid grid-cols-3 gap-1 shrink-0">
          {(["years", "months", "days"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => update(num, u)}
              className={`border-2 border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${unit === u ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
            >
              {u === "years" ? "Yrs" : u === "months" ? "Mo" : "Days"}
            </button>
          ))}
        </div>
      </div>
      {hint && (
        <div className={`flex items-center gap-1.5 text-[11px] ${hintCls}`}>
          {hintIsGrowth && <TrendingUp className="h-3.5 w-3.5" />}
          {hintIsBMI    && <Scale className="h-3.5 w-3.5" />}
          {hintIsInter  && <span>⚠</span>}
          {hint}
        </div>
      )}
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
