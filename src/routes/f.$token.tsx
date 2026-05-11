/**
 * PUBLIC form filler — /f/:token
 * No authentication required. Never queries the clinical Patient database.
 * Respondents are identified only by a self-chosen name/email/code (optional).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { z } from "zod";
import { evaluateConditions, type FormField } from "@/lib/store";
import { API_BASE } from "@/lib/api";
import { AlertTriangle, MapPin, Loader2, X, Image, CheckCircle2 } from "lucide-react";

const searchSchema = z.object({ preview: z.boolean().optional() });

export const Route = createFileRoute("/f/$token")({
  component: PublicFiller,
  validateSearch: (s) => searchSchema.parse(s),
});

interface PublicFormDef {
  id: string;
  name: string;
  category: string;
  description?: string;
  fields: FormField[];
  longitudinal: boolean;
  status: string;
  is_public: boolean;
  allowed_filler_emails: string[];
  require_respondent_info?: boolean;
  require_respondent_id?: boolean;
}

interface GeoVal { lat: number; lng: number; accuracy?: number; ts: number; }
interface BPVal { systolic: number | string; diastolic: number | string; }

function isFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  const vi = field.visibleIf;
  if (vi && vi.rules.length > 0) {
    const evalRule = (r: (typeof vi.rules)[number]): boolean => {
      const raw = values[r.fieldId];
      const rv = r.value;
      switch (r.op) {
        case "eq": return String(raw ?? "") === String(rv);
        case "neq": return String(raw ?? "") !== String(rv);
        case "gt": return Number(raw) > Number(rv);
        case "lt": return Number(raw) < Number(rv);
        case "contains": return String(raw ?? "").includes(String(rv));
        default: return true;
      }
    };
    const ok = vi.mode === "all" ? vi.rules.every(evalRule) : vi.rules.some(evalRule);
    if (!ok) return false;
  }
  return evaluateConditions(field.showIf, values);
}

function getOptions(f: FormField): { label: string; value: string }[] {
  if (f.optionObjects && f.optionObjects.length > 0) return f.optionObjects;
  return (f.options ?? []).map((o) => ({ label: o, value: o }));
}

function evalCalc(formula: string, values: Record<string, unknown>, fields: FormField[]): string {
  try {
    let expr = formula;
    for (const f of fields) {
      const varName = f.variableName ?? f.id;
      const val = Number(values[f.id]);
      if (Number.isFinite(val)) expr = expr.replace(new RegExp(`\\b${varName}\\b`, "g"), String(val));
    }
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${expr})`)();
    const n = Number(result);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—";
  } catch { return "—"; }
}

function EmailVerificationGate({
  form,
  token,
  onVerified,
}: {
  form: PublicFormDef;
  token: string;
  onVerified: (email: string) => void;
}) {
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim();
    if (!trimmed.includes("@")) { setError("Enter a valid email address."); return; }
    const allowed = form.allowed_filler_emails.map((a) => a.toLowerCase());
    if (!allowed.includes(trimmed.toLowerCase())) {
      setError("Your email is not authorized to fill this form. Contact the form owner.");
      return;
    }
    sessionStorage.setItem(`form_access_${token}`, trimmed);
    onVerified(trimmed);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b-4 border-border bg-primary px-4 py-5">
        <div className="mx-auto max-w-xl">
          <h1 className="font-display text-3xl uppercase leading-tight">{form.name}</h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-foreground/70">
            {form.category}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-xl px-4 pt-10">
        <div className="brutal p-6 space-y-4">
          <div className="space-y-1">
            <div className="font-display text-lg uppercase tracking-widest">Private form</div>
            <p className="text-sm text-muted-foreground">
              This form is restricted. Enter your email address to continue.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Email address</label>
              <input
                type="email"
                autoFocus
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setError(""); }}
                className="input-brutal w-full"
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="text-xs font-bold uppercase tracking-wider text-destructive">{error}</p>}
            <button type="submit" className="btn-brutal w-full">Continue →</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function PublicFiller() {
  const { token } = Route.useParams();
  const { preview } = Route.useSearch();

  const [form, setForm] = useState<PublicFormDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [respondentName, setRespondentName] = useState("");
  const [respondentEmail, setRespondentEmail] = useState("");
  const [respondentCode, setRespondentCode] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [geoLoading, setGeoLoading] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // null = not yet determined; "" = public (no gate); string = verified email
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/forms/public/${token}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          const body = await r.json().catch(() => ({ detail: "Form not found" }));
          const msg = body.detail ?? "Form not found";
          console.error(`[PublicFiller] ${r.status} loading form token=${token}:`, msg);
          if (!cancelled) setLoadError(msg);
        } else {
          const data: PublicFormDef = await r.json();
          if (!cancelled) setForm(data);
        }
      })
      .catch((err) => {
        console.error(`[PublicFiller] Network error loading form token=${token}:`, err);
        if (!cancelled) setLoadError("Could not load form. Check your connection.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  // Once form loads, check access
  useEffect(() => {
    if (!form) return;
    if (form.is_public) { setVerifiedEmail(""); return; }
    const cached = sessionStorage.getItem(`form_access_${token}`);
    if (cached && form.allowed_filler_emails.some((e) => e.toLowerCase() === cached.toLowerCase())) {
      setVerifiedEmail(cached);
      setRespondentEmail(cached);
    } else {
      setVerifiedEmail(null); // show gate
    }
  }, [form, token]);

  const handleEmailVerified = (email: string) => {
    setVerifiedEmail(email);
    setRespondentEmail(email);
  };

  const set = (fieldId: string, val: unknown) =>
    setValues((prev) => ({ ...prev, [fieldId]: val }));

  const allVisible = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => isFieldVisible(f, values));
  }, [form, values]);

  const pages = useMemo(() => {
    const result: FormField[][] = [[]];
    for (const f of allVisible) {
      if (f.type === "page_break") result.push([]);
      else result[result.length - 1].push(f);
    }
    return result;
  }, [allVisible]);

  const visibleFields = pages[page] ?? [];
  const isLastPage = page >= pages.length - 1;

  const captureGeo = (fieldId: string) => {
    if (!("geolocation" in navigator)) { setError("Geolocation not supported."); return; }
    setGeoLoading(fieldId);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set(fieldId, { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), accuracy: pos.coords.accuracy, ts: Date.now() } satisfies GeoVal);
        setGeoLoading(null);
      },
      (e) => { setError(`Location error: ${e.message}`); setGeoLoading(null); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const validatePage = (): string | null => {
    for (const f of visibleFields) {
      if (f.type === "section_header" || f.type === "calculated") continue;
      const v = values[f.id];
      const empty = v === undefined || v === "" || v === null || (Array.isArray(v) && v.length === 0);
      if (f.required && empty) return `"${f.label}" is required.`;
    }
    return null;
  };

  const handleNext = () => {
    const e = validatePage();
    if (e) { setError(e); return; }
    setError("");
    setPage((p) => p + 1);
    window.scrollTo(0, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview) { setError("Preview mode — responses are not saved."); return; }
    const e2 = validatePage();
    if (e2) { setError(e2); return; }

    const visibleIds = new Set(allVisible.map((f) => f.id));
    const data: Record<string, unknown> = {};
    Object.entries(values).forEach(([k, v]) => { if (visibleIds.has(k)) data[k] = v; });

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/forms/public/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_name: respondentName || undefined, respondent_email: respondentEmail || undefined, respondent_id: respondentCode || undefined, data }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Submission failed" }));
        setError(body.detail ?? "Submission failed");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Could not submit. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // — Loading / error / closed states —
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    const isDraft = loadError.toLowerCase().includes("not yet published");
    const isClosed = loadError.toLowerCase().includes("closed");
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-2">
          <h1 className="font-display text-2xl uppercase tracking-widest">
            {isDraft ? "Not Yet Published" : isClosed ? "Form Closed" : "Form Not Found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isDraft
              ? "This form is still in draft mode and is not yet accepting responses."
              : isClosed
              ? "This form is no longer accepting responses. Existing data has been preserved."
              : "The link may be incorrect or the form may have been removed."}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 mx-auto text-primary" />
          <h1 className="font-display text-2xl uppercase tracking-widest">Thank you!</h1>
          <p className="text-sm text-muted-foreground">Your response has been recorded.</p>
        </div>
      </div>
    );
  }

  if (!form) return null;

  // Private form gate: show email verification if not yet confirmed
  if (!form.is_public && verifiedEmail === null) {
    return <EmailVerificationGate form={form} token={token} onVerified={handleEmailVerified} />;
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="border-b-4 border-border bg-primary px-4 py-5">
        <div className="mx-auto max-w-xl">
          {preview && (
            <div className="mb-2 border-2 border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-foreground inline-block">
              Preview mode — responses not saved
            </div>
          )}
          <h1 className="font-display text-3xl uppercase leading-tight">{form.name}</h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-foreground/70">
            {form.category}{form.longitudinal ? " · Longitudinal" : ""}
          </p>
          {form.description && (
            <p className="mt-2 text-sm text-foreground/80">{form.description}</p>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-xl px-4 pt-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Respondent info */}
          {(form.require_respondent_info || form.longitudinal) && (
            <div className="brutal p-4 space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Your information</div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Name</label>
                <input value={respondentName} onChange={(e) => setRespondentName(e.target.value)} className="input-brutal" placeholder="Optional" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Email</label>
                <input type="email" value={respondentEmail} onChange={(e) => setRespondentEmail(e.target.value)} className="input-brutal" placeholder="Optional" />
              </div>
              {form.longitudinal && (
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
                    Respondent code <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={respondentCode}
                    onChange={(e) => setRespondentCode(e.target.value)}
                    className="input-brutal font-mono"
                    placeholder="e.g. RK0501 — use the same code every visit"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">Enter the same code each time you fill this form to link your responses over time.</p>
                </div>
              )}
            </div>
          )}

          {/* Page progress */}
          {pages.length > 1 && (
            <div className="flex items-center gap-1">
              {pages.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 border border-border ${i <= page ? "bg-primary" : "bg-muted"}`} />
              ))}
              <span className="ml-2 shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {page + 1}/{pages.length}
              </span>
            </div>
          )}

          {/* Fields */}
          <div className="brutal space-y-4 p-4">
            {visibleFields.map((f) => (
              <PublicFieldRenderer
                key={f.id}
                field={f}
                value={values[f.id]}
                values={values}
                allFields={form.fields}
                geoLoading={geoLoading}
                onChange={(v) => set(f.id, v)}
                onGeo={() => captureGeo(f.id)}
                onGeoClear={() => setValues((prev) => { const n = { ...prev }; delete n[f.id]; return n; })}
              />
            ))}
            {visibleFields.length === 0 && (
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Answer earlier questions to continue.
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm font-bold uppercase tracking-wider text-destructive">{error}</p>
          )}

          {isLastPage ? (
            <button
              type="submit"
              disabled={submitting || !!preview}
              className="btn-brutal w-full disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          ) : (
            <button type="button" onClick={handleNext} className="btn-brutal w-full">
              Next →
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Field renderer (same types as authenticated filler) ───────────────────────

interface PFRProps {
  field: FormField;
  value: unknown;
  values: Record<string, unknown>;
  allFields: FormField[];
  geoLoading: string | null;
  onChange: (v: unknown) => void;
  onGeo: () => void;
  onGeoClear: () => void;
}

function PublicFieldRenderer({ field: f, value, values, allFields, geoLoading, onChange, onGeo, onGeoClear }: PFRProps) {
  const opts = getOptions(f);

  if (f.type === "section_header") {
    return (
      <div className="border-b-2 border-border pb-2 pt-4">
        <div className="font-display text-base uppercase tracking-widest">{f.label}</div>
        {f.hint && <p className="mt-0.5 text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
        {f.label}
        {f.unit && <span className="text-muted-foreground"> ({f.unit})</span>}
        {f.required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {f.hint && <p className="mb-1.5 text-[11px] text-muted-foreground">{f.hint}</p>}

      {(f.type === "short_text" || f.type === "text") && (
        <input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal" />
      )}
      {(f.type === "long_text" || f.type === "textarea") && (
        <textarea rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal resize-none" />
      )}
      {f.type === "number" && (
        <input type="number" step="any" inputMode="decimal" value={(value as number | string) ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="input-brutal font-mono" />
      )}
      {f.type === "date" && (
        <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal" />
      )}
      {f.type === "time" && (
        <input type="time" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal" />
      )}
      {f.type === "datetime" && (
        <input type="datetime-local" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal" />
      )}
      {(f.type === "select_one" || f.type === "select" || f.type === "radio") && (
        f.displayAs === "dropdown" ? (
          <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="input-brutal">
            <option value="">— select —</option>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <div className="grid gap-1.5">
            {opts.map((o) => {
              const active = value === o.value;
              return (
                <label key={o.value} className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                  <input type="radio" name={f.id} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
                  {o.label}
                </label>
              );
            })}
            {f.includeOther && (
              <label className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${value === "__other__" ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                <input type="radio" name={f.id} checked={value === "__other__"} onChange={() => onChange("__other__")} className="sr-only" />
                Other
              </label>
            )}
          </div>
        )
      )}
      {(f.type === "select_many" || f.type === "multiselect") && (
        <div className="grid gap-1.5">
          {opts.map((o) => {
            const arr = (value as string[] | undefined) ?? [];
            const active = arr.includes(o.value);
            return (
              <label key={o.value} className={`flex cursor-pointer items-center gap-2 border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                <input type="checkbox" checked={active} onChange={(e) => { const next = e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value); onChange(next); }} className="sr-only" />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
      {(f.type === "yes_no" || f.type === "boolean") && (
        <div className="grid grid-cols-2 gap-2">
          {([{ l: "Yes", v: true }, { l: "No", v: false }] as const).map((o) => (
            <button key={o.l} type="button" onClick={() => onChange(o.v)} className={`border-2 border-border py-3 text-sm font-bold uppercase tracking-wider ${value === o.v ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>{o.l}</button>
          ))}
        </div>
      )}
      {f.type === "slider" && (
        <div className="space-y-1">
          <input type="range" min={f.sliderMin ?? 0} max={f.sliderMax ?? 100} step={f.sliderStep ?? 1} value={(value as number) ?? f.sliderMin ?? 0} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>{f.leftLabel ?? String(f.sliderMin ?? 0)}</span>
            {f.showValue !== false && <span className="text-foreground">{(value as number) ?? f.sliderMin ?? 0}{f.unit ? ` ${f.unit}` : ""}</span>}
            <span>{f.rightLabel ?? String(f.sliderMax ?? 100)}</span>
          </div>
        </div>
      )}
      {f.type === "rating" && (
        <div className="flex gap-1">
          {Array.from({ length: f.maxRating ?? 5 }, (_, i) => i + 1).map((n) => {
            const active = (value as number | undefined) !== undefined && n <= (value as number);
            return (
              <button key={n} type="button" onClick={() => onChange(n)} className={`min-w-[2rem] border-2 border-border px-2 py-1 text-sm font-bold ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                {f.ratingType !== "numbers" ? (active ? "★" : "☆") : String(n)}
              </button>
            );
          })}
        </div>
      )}
      {f.type === "calculated" && (
        <div className="input-brutal flex items-center justify-between bg-muted">
          <span className="font-mono text-lg">{f.formula ? evalCalc(f.formula, values, allFields) : "—"}</span>
          {f.unit && <span className="text-sm font-bold text-muted-foreground">{f.unit}</span>}
        </div>
      )}
      {f.type === "matrix" && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="border-2 border-border px-2 py-1 text-left font-bold uppercase tracking-wider" />
                {(f.matrixColumns ?? []).map((col) => <th key={col} className="border-2 border-border px-2 py-1 text-center font-bold uppercase tracking-wider">{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {(f.matrixRows ?? []).map((row) => (
                <tr key={row}>
                  <td className="border-2 border-border px-2 py-1 font-bold">{row}</td>
                  {(f.matrixColumns ?? []).map((col) => (
                    <td key={col} className="border-2 border-border px-2 py-1 text-center">
                      <input type="radio" name={`${f.id}_${row}`} checked={(value as Record<string, string> | undefined)?.[row] === col} onChange={() => onChange({ ...(value as Record<string, string> | undefined ?? {}), [row]: col })} className="accent-primary" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.type === "measurement" && f.measurementType === "BP" && (
        <BPMeasurement value={value as BPVal | undefined} onChange={onChange} />
      )}
      {f.type === "measurement" && f.measurementType !== "BP" && (
        <SingleMeasurement field={f} value={value as number | string | undefined} onChange={onChange} />
      )}
      {f.type === "location" && (
        <div className="space-y-2">
          <button type="button" onClick={onGeo} disabled={geoLoading === f.id} className="btn-brutal flex w-full items-center justify-center gap-2 text-xs disabled:opacity-50">
            {geoLoading === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {value ? "Re-capture location" : "Capture location"}
          </button>
          {!!value && (
            <GeoDisplay geo={value as GeoVal} onClear={onGeoClear} />
          )}
        </div>
      )}
      {f.type === "photo" && (
        <div className="space-y-2">
          <label className="btn-brutal flex w-full cursor-pointer items-center justify-center gap-2 text-xs">
            <Image className="h-4 w-4" />
            {value ? "Replace photo" : "Take / upload photo"}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => onChange(r.result as string); r.readAsDataURL(file); }} />
          </label>
          {!!value && (
            <div className="relative">
              <img src={value as string} alt="Captured" className="w-full border-2 border-border object-contain" style={{ maxHeight: 200 }} />
              <button type="button" onClick={() => onChange(undefined)} className="absolute right-1 top-1 border-2 border-border bg-card p-1 hover:bg-destructive hover:text-destructive-foreground"><X className="h-3 w-3" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GeoDisplay({ geo, onClear }: { geo: GeoVal; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-2 border-border bg-card p-2 font-mono text-[11px]">
      <div>
        <div className="font-bold">{geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}</div>
        {geo.accuracy && <div className="text-muted-foreground">± {Math.round(geo.accuracy)} m</div>}
      </div>
      <button type="button" onClick={onClear} className="border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function BPMeasurement({ value, onChange }: { value: BPVal | undefined; onChange: (v: unknown) => void }) {
  const bp = value ?? { systolic: "", diastolic: "" };
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Systolic</label>
        <input type="number" inputMode="numeric" placeholder="120" value={bp.systolic} onChange={(e) => onChange({ ...bp, systolic: e.target.value === "" ? "" : Number(e.target.value) })} className="input-brutal font-mono" />
      </div>
      <div className="mb-2 text-xl font-bold">/</div>
      <div className="flex-1">
        <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Diastolic</label>
        <input type="number" inputMode="numeric" placeholder="80" value={bp.diastolic} onChange={(e) => onChange({ ...bp, diastolic: e.target.value === "" ? "" : Number(e.target.value) })} className="input-brutal font-mono" />
      </div>
      <div className="mb-2 text-xs font-bold text-muted-foreground">mmHg</div>
    </div>
  );
}

function SingleMeasurement({ field, value, onChange }: { field: FormField; value: number | string | undefined; onChange: (v: unknown) => void }) {
  const unitMap: Record<string, string> = { temperature: "°C", SpO2: "%", BSL: "mg/dL", MUAC: "cm", weight: "kg", height: "cm" };
  const unit = field.unit ?? (field.measurementType ? (unitMap[field.measurementType] ?? "") : "");
  return (
    <div className="flex items-center gap-2">
      <input type="number" step="any" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="input-brutal flex-1 font-mono" />
      {unit && <span className="text-sm font-bold text-muted-foreground">{unit}</span>}
    </div>
  );
}
