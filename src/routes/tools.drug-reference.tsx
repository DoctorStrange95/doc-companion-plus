import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, PageShell } from "@/components/PageShell";
import { useAuth } from "@/lib/auth";
import { api, API_BASE, ApiError, getToken } from "@/lib/api";
import {
  Search, ChevronDown, ChevronUp, Pill, Pencil, Trash2,
  Upload, Download, Plus, CheckCircle2, AlertCircle, X, Loader2,
} from "lucide-react";

export const Route = createFileRoute("/tools/drug-reference")({ component: DrugReferencePage });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Regimen {
  id: string;
  drug_id: string;
  generic_name: string;
  brand_names: string[] | string;
  drug_class: string;
  adult_dose: string;
  pediatric_dose: string;
  max_dose: string;
  route: string;
  site: string;
  frequency: string;
  duration: string;
  strength: string;
  formulation: string;
  line_of_treatment: string;
  notes: string;
  contraindications: string;
}

interface Condition {
  id: string;
  name: string;
  aliases: string[] | string;
  category: string;
  icd_code: string;
  notes: string;
  regimens: Regimen[];
}

interface DrugIndication {
  id: string;
  condition_id: string;
  condition_name: string;
  adult_dose: string;
  pediatric_dose: string;
  max_dose: string;
  route: string;
  site: string;
  frequency: string;
  duration: string;
  strength: string;
  formulation: string;
  line_of_treatment: string;
  notes: string;
  contraindications: string;
}

interface Drug {
  id: string;
  generic_name: string;
  brand_names: string[] | string;
  drug_class: string;
  category: string;
  indications: DrugIndication[];
}

interface CacheData { conditions: Condition[]; drugs: Drug[]; cached_at: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_KEY = "drug_reference_v1";
const CATEGORIES = [
  "Respiratory", "Endocrine", "Cardiovascular", "Dermatology", "GI",
  "Haematology", "Musculoskeletal", "Infectious Disease",
  "Gynaecology", "Paediatric", "Psychiatry", "Ophthalmology", "Emergency",
];
const LINE_ORDER = ["First line", "Second line", "Third line", "Adjuvant", "Prophylaxis"];
const ROUTES = ["Oral", "IM", "ID", "IV", "SC", "Topical", "Inhaled", "Sublingual", "Eye/Ear drops", "Other"];
const INJECTION_SITES = ["Deltoid (upper arm)", "Anterolateral thigh", "Gluteal (upper outer)", "Abdomen", "Forearm (ID)", "Dorsal forearm (ID)", "Other"];
const FREQUENCIES = ["OD", "BD", "TDS", "QID", "SOS", "Weekly", "Stat", "As needed", "Other"];
const FORMULATIONS = ["Tablet", "Capsule", "Syrup", "Injection", "Ointment/Cream", "Inhaler/MDI", "Eye/Ear drops", "Sachet", "Powder", "Lotion", "Gel", "Other"];
const LINES = ["First line", "Second line", "Third line", "Adjuvant", "Prophylaxis"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toArr(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

function groupByLine(regimens: Regimen[]) {
  const map: Record<string, Regimen[]> = {};
  for (const r of regimens) {
    const k = r.line_of_treatment || "Other";
    (map[k] ??= []).push(r);
  }
  return [...LINE_ORDER, "Other"]
    .filter(l => map[l])
    .map(l => ({ line: l, regimens: map[l] }));
}

function searchLocal(data: CacheData, q: string, type: string, cat: string) {
  const ql = q.toLowerCase().trim();
  let { conditions, drugs } = data;

  if (cat) conditions = conditions.filter(c => c.category === cat);

  if (!ql && !cat) return { conditions: [], drugs: [] };
  if (!ql && cat) return { conditions, drugs: [] };

  if (type !== "drug") {
    conditions = conditions.filter(c =>
      c.name.toLowerCase().includes(ql) ||
      toArr(c.aliases).some(a => a.toLowerCase().includes(ql)) ||
      c.icd_code.toLowerCase().includes(ql)
    );
  } else { conditions = []; }

  if (type !== "condition") {
    drugs = drugs.filter(d =>
      d.generic_name.toLowerCase().includes(ql) ||
      toArr(d.brand_names).some(b => b.toLowerCase().includes(ql)) ||
      d.drug_class.toLowerCase().includes(ql)
    );
  } else { drugs = []; }

  return { conditions, drugs };
}

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? res.statusText);
  return body as T;
}

// ── ConditionCard ─────────────────────────────────────────────────────────────

function RegimenRow({ r }: { r: Regimen }) {
  const brands = toArr(r.brand_names);
  const routeStr = [r.route, r.site].filter(Boolean).join(" — ");
  return (
    <div className="py-3 border-b border-border/30 last:border-0">
      {/* Drug name + strength + formulation */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-[14px] uppercase tracking-wide">{r.generic_name}</span>
        {r.strength && <span className="text-[12px] text-muted-foreground">{r.strength}</span>}
        {r.formulation && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-secondary/20 px-1.5 py-0.5">
            {r.formulation}
          </span>
        )}
      </div>
      {/* Route + site */}
      {routeStr && (
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {routeStr}
        </div>
      )}
      {/* Adult dose */}
      {r.adult_dose && (
        <div className="mt-1.5 flex gap-2 text-sm">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 pt-0.5">Adult</span>
          <span>
            · {r.adult_dose}
            {r.duration && <span className="text-muted-foreground"> × {r.duration}</span>}
            {r.frequency && r.frequency !== r.adult_dose && (
              <span className="text-muted-foreground"> ({r.frequency})</span>
            )}
          </span>
        </div>
      )}
      {/* Max dose */}
      {r.max_dose && (
        <div className="mt-0.5 flex gap-2 text-sm">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 pt-0.5">Max</span>
          <span className="text-muted-foreground">· {r.max_dose}</span>
        </div>
      )}
      {/* Pediatric dose */}
      {r.pediatric_dose && (
        <div className="mt-0.5 flex gap-2 text-sm">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 pt-0.5">Peds</span>
          <span className="text-muted-foreground">· {r.pediatric_dose}</span>
        </div>
      )}
      {/* Brands */}
      {brands.length > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          Brands: {brands.join(", ")}
        </div>
      )}
      {/* Notes */}
      {r.notes && <div className="mt-1 text-[11px] text-amber-700 font-medium">⚠ {r.notes}</div>}
      {r.contraindications && <div className="mt-0.5 text-[11px] text-destructive/80">✕ CI: {r.contraindications}</div>}
    </div>
  );
}

function ConditionCard({ condition }: { condition: Condition }) {
  const [expanded, setExpanded] = useState(true);
  const aliases = toArr(condition.aliases);
  const groups = groupByLine(condition.regimens);

  return (
    <div className="brutal mb-3 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-start justify-between gap-3 bg-card p-4 text-left hover:bg-primary/10"
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg uppercase leading-tight">{condition.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {aliases.length > 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {aliases.slice(0, 4).join(" · ")}
              </span>
            )}
            {condition.icd_code && (
              <span className="border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                {condition.icd_code}
              </span>
            )}
            {condition.category && (
              <span className="bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                {condition.category}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {condition.regimens.length} drug{condition.regimens.length !== 1 ? "s" : ""}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && groups.length > 0 && (
        <div className="border-t-2 border-border">
          {groups.map(({ line, regimens }) => (
            <div key={line}>
              <div className="px-4 py-2 bg-secondary/10 flex items-center gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest">{line}</div>
                <div className="flex-1 h-px bg-border/60" />
              </div>
              <div className="px-4">
                {regimens.map(r => <RegimenRow key={r.id} r={r} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {expanded && groups.length === 0 && (
        <div className="border-t-2 border-border p-4 text-[11px] text-muted-foreground">
          No regimens added yet.
        </div>
      )}
    </div>
  );
}

// ── DrugCard ──────────────────────────────────────────────────────────────────

function DrugCard({ drug }: { drug: Drug }) {
  const [expanded, setExpanded] = useState(true);
  const brands = toArr(drug.brand_names);
  const adultInds = drug.indications.filter(i => i.adult_dose);
  const pedInds = drug.indications.filter(i => i.pediatric_dose);

  return (
    <div className="brutal mb-3 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-start justify-between gap-3 bg-card p-4 text-left hover:bg-primary/10"
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg uppercase leading-tight">{drug.generic_name}</div>
          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {drug.drug_class}
          </div>
          {brands.length > 0 && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Brands: {brands.join(", ")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {drug.indications.length} use{drug.indications.length !== 1 ? "s" : ""}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t-2 border-border">
          {drug.indications.length === 0 && (
            <p className="p-4 text-[11px] text-muted-foreground">No indications linked yet.</p>
          )}

          {/* Adult Dosage section */}
          {adultInds.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-secondary/10 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest">Adult Dosage</span>
                <div className="flex-1 h-px bg-border/60" />
              </div>
              <div className="px-4">
                {adultInds.map(ind => {
                  const routeStr = [ind.route, ind.site].filter(Boolean).join(" — ");
                  return (
                    <div key={ind.id + "_adult"} className="py-3 border-b border-border/30 last:border-0">
                      <div className="font-bold text-[13px]">{ind.condition_name}
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase">
                          {ind.line_of_treatment}
                        </span>
                      </div>
                      {routeStr && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                          {routeStr}
                        </div>
                      )}
                      <div className="mt-1 text-sm">
                        · {ind.adult_dose}
                        {ind.duration && <span className="text-muted-foreground"> × {ind.duration}</span>}
                        {ind.frequency && (
                          <span className="text-muted-foreground"> ({ind.frequency})</span>
                        )}
                      </div>
                      {ind.max_dose && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Max dose: {ind.max_dose}</div>
                      )}
                      {(ind.strength || ind.formulation) && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Available: {[ind.strength, ind.formulation].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {ind.notes && (
                        <div className="mt-0.5 text-[11px] text-amber-700 font-medium">⚠ {ind.notes}</div>
                      )}
                      {ind.contraindications && (
                        <div className="mt-0.5 text-[11px] text-destructive/80">✕ CI: {ind.contraindications}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pediatric Dosage section */}
          {pedInds.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-secondary/10 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest">Pediatric Dosage</span>
                <div className="flex-1 h-px bg-border/60" />
              </div>
              <div className="px-4">
                {pedInds.map(ind => {
                  const routeStr = [ind.route, ind.site].filter(Boolean).join(" — ");
                  return (
                    <div key={ind.id + "_ped"} className="py-3 border-b border-border/30 last:border-0">
                      <div className="font-bold text-[13px]">{ind.condition_name}
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase">
                          {ind.line_of_treatment}
                        </span>
                      </div>
                      {routeStr && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                          {routeStr}
                        </div>
                      )}
                      <div className="mt-1 text-sm text-muted-foreground">
                        · {ind.pediatric_dose}
                        {ind.duration && <span> × {ind.duration}</span>}
                        {ind.frequency && <span> ({ind.frequency})</span>}
                      </div>
                      {ind.max_dose && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Max dose: {ind.max_dose}</div>
                      )}
                      {(ind.strength || ind.formulation) && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Available: {[ind.strength, ind.formulation].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {ind.notes && (
                        <div className="mt-0.5 text-[11px] text-amber-700 font-medium">⚠ {ind.notes}</div>
                      )}
                      {ind.contraindications && (
                        <div className="mt-0.5 text-[11px] text-destructive/80">✕ CI: {ind.contraindications}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Admin: Quick Add ──────────────────────────────────────────────────────────

function AdminQuickAdd({
  data,
  onSuccess,
}: { data: CacheData | null; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Condition
  const [condQ, setCondQ] = useState("");
  const [condId, setCondId] = useState<string | null>(null);
  const [condAliases, setCondAliases] = useState("");
  const [condCategory, setCondCategory] = useState("");
  const [condIcd, setCondIcd] = useState("");
  const [showCondDrop, setShowCondDrop] = useState(false);

  // Drug
  const [drugQ, setDrugQ] = useState("");
  const [drugId, setDrugId] = useState<string | null>(null);
  const [drugBrands, setDrugBrands] = useState("");
  const [drugClass, setDrugClass] = useState("");
  const [showDrugDrop, setShowDrugDrop] = useState(false);

  // Regimen
  const [adultDose, setAdultDose] = useState("");
  const [maxDose, setMaxDose] = useState("");
  const [pedDose, setPedDose] = useState("");
  const [route, setRoute] = useState("");
  const [site, setSite] = useState("");
  const [freq, setFreq] = useState("");
  const [dur, setDur] = useState("");
  const [strength, setStrength] = useState("");
  const [formulation, setFormulation] = useState("");
  const [line, setLine] = useState("First line");
  const [notes, setNotes] = useState("");
  const [contra, setContra] = useState("");

  const condSuggestions = useMemo(() => {
    if (!data || !condQ.trim()) return [];
    const ql = condQ.toLowerCase();
    return data.conditions.filter(c => c.name.toLowerCase().includes(ql)).slice(0, 6);
  }, [data, condQ]);

  const drugSuggestions = useMemo(() => {
    if (!data || !drugQ.trim()) return [];
    const ql = drugQ.toLowerCase();
    return data.drugs.filter(d =>
      d.generic_name.toLowerCase().includes(ql) ||
      toArr(d.brand_names).some(b => b.toLowerCase().includes(ql))
    ).slice(0, 6);
  }, [data, drugQ]);

  const reset = () => {
    setCondQ(""); setCondId(null); setCondAliases(""); setCondCategory(""); setCondIcd("");
    setDrugQ(""); setDrugId(null); setDrugBrands(""); setDrugClass("");
    setAdultDose(""); setMaxDose(""); setPedDose(""); setRoute(""); setSite(""); setFreq(""); setDur("");
    setStrength(""); setFormulation(""); setLine("First line"); setNotes(""); setContra("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!condQ.trim() || !drugQ.trim()) {
      setMsg({ ok: false, text: "Condition name and drug name are required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // Resolve condition
      let resolvedCondId = condId;
      if (!resolvedCondId) {
        const aliases = condAliases.split(",").map(s => s.trim()).filter(Boolean);
        const c = await api<{ id: string }>("/api/drug-reference/conditions", {
          method: "POST",
          body: JSON.stringify({ name: condQ.trim(), aliases, category: condCategory, icd_code: condIcd }),
        });
        resolvedCondId = c.id;
      }

      // Resolve drug
      let resolvedDrugId = drugId;
      if (!resolvedDrugId) {
        const brands = drugBrands.split(",").map(s => s.trim()).filter(Boolean);
        const d = await api<{ id: string }>("/api/drug-reference/drugs", {
          method: "POST",
          body: JSON.stringify({ generic_name: drugQ.trim(), brand_names: brands, drug_class: drugClass }),
        });
        resolvedDrugId = d.id;
      }

      // Create regimen
      await api("/api/drug-reference/regimens", {
        method: "POST",
        body: JSON.stringify({
          condition_id: resolvedCondId, drug_id: resolvedDrugId,
          adult_dose: adultDose, max_dose: maxDose, pediatric_dose: pedDose,
          route, site, frequency: freq, duration: dur, strength, formulation,
          line_of_treatment: line, notes, contraindications: contra,
        }),
      });

      setMsg({ ok: true, text: "Regimen added successfully." });
      reset();
      onSuccess();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? String(e.detail) : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 border-2 p-3 text-xs font-bold uppercase tracking-wider ${msg.ok ? "border-green-600 bg-green-50 text-green-800" : "border-destructive bg-destructive/10 text-destructive"}`}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* Condition */}
      <div className="brutal p-4 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Condition</div>
        <div className="relative">
          <F label="Condition Name *">
            <input className="input-brutal" value={condQ}
              onChange={e => { setCondQ(e.target.value); setCondId(null); setShowCondDrop(true); }}
              onFocus={() => setShowCondDrop(true)}
              onBlur={() => setTimeout(() => setShowCondDrop(false), 150)}
              placeholder="e.g. Upper Respiratory Tract Infection" required />
          </F>
          {showCondDrop && condSuggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-full border-2 border-border bg-card shadow-lg">
              {condSuggestions.map(c => (
                <li key={c.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-primary/10 font-medium"
                    onMouseDown={() => { setCondQ(c.name); setCondId(c.id); setShowCondDrop(false); }}>
                    {c.name}
                    {condId === c.id && <span className="ml-2 text-xs text-green-600">(existing)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {condId && <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">✓ Using existing condition</p>}
        {!condId && condQ && (
          <div className="grid grid-cols-2 gap-3">
            <F label="Aliases (comma-separated)">
              <input className="input-brutal" value={condAliases}
                onChange={e => setCondAliases(e.target.value)} placeholder="URTI, Cold" />
            </F>
            <F label="Category">
              <select className="input-brutal" value={condCategory} onChange={e => setCondCategory(e.target.value)}>
                <option value="">Select</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </F>
            <F label="ICD Code (optional)">
              <input className="input-brutal" value={condIcd}
                onChange={e => setCondIcd(e.target.value)} placeholder="J06.9" />
            </F>
          </div>
        )}
      </div>

      {/* Drug */}
      <div className="brutal p-4 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Drug</div>
        <div className="relative">
          <F label="Generic Name *">
            <input className="input-brutal" value={drugQ}
              onChange={e => { setDrugQ(e.target.value); setDrugId(null); setShowDrugDrop(true); }}
              onFocus={() => setShowDrugDrop(true)}
              onBlur={() => setTimeout(() => setShowDrugDrop(false), 150)}
              placeholder="e.g. Azithromycin" required />
          </F>
          {showDrugDrop && drugSuggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-full border-2 border-border bg-card shadow-lg">
              {drugSuggestions.map(d => (
                <li key={d.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-primary/10 font-medium"
                    onMouseDown={() => { setDrugQ(d.generic_name); setDrugId(d.id); setShowDrugDrop(false); }}>
                    {d.generic_name}
                    {toArr(d.brand_names).length > 0 && <span className="text-muted-foreground text-xs ml-2">{toArr(d.brand_names).slice(0, 2).join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {drugId && <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">✓ Using existing drug</p>}
        {!drugId && drugQ && (
          <div className="grid grid-cols-2 gap-3">
            <F label="Brand Names (comma-separated)">
              <input className="input-brutal" value={drugBrands}
                onChange={e => setDrugBrands(e.target.value)} placeholder="Azee, Zithromax" />
            </F>
            <F label="Drug Class">
              <input className="input-brutal" value={drugClass}
                onChange={e => setDrugClass(e.target.value)} placeholder="Macrolide Antibiotic" />
            </F>
          </div>
        )}
      </div>

      {/* Regimen */}
      <div className="brutal p-4 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Regimen Details</div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Adult Dose"><input className="input-brutal" value={adultDose} onChange={e => setAdultDose(e.target.value)} placeholder="500 mg OD" /></F>
          <F label="Max Dose"><input className="input-brutal" value={maxDose} onChange={e => setMaxDose(e.target.value)} placeholder="2 g/day" /></F>
          <F label="Pediatric Dose"><input className="input-brutal" value={pedDose} onChange={e => setPedDose(e.target.value)} placeholder="10 mg/kg/day" /></F>
          <F label="Route"><select className="input-brutal" value={route} onChange={e => setRoute(e.target.value)}><option value="">Select</option>{ROUTES.map(r => <option key={r}>{r}</option>)}</select></F>
          <F label="Site (injections)"><select className="input-brutal" value={site} onChange={e => setSite(e.target.value)}><option value="">N/A</option>{INJECTION_SITES.map(s => <option key={s}>{s}</option>)}</select></F>
          <F label="Frequency"><select className="input-brutal" value={freq} onChange={e => setFreq(e.target.value)}><option value="">Select</option>{FREQUENCIES.map(f => <option key={f}>{f}</option>)}</select></F>
          <F label="Duration"><input className="input-brutal" value={dur} onChange={e => setDur(e.target.value)} placeholder="5 days" /></F>
          <F label="Strength"><input className="input-brutal" value={strength} onChange={e => setStrength(e.target.value)} placeholder="500 mg" /></F>
          <F label="Formulation"><select className="input-brutal" value={formulation} onChange={e => setFormulation(e.target.value)}><option value="">Select</option>{FORMULATIONS.map(f => <option key={f}>{f}</option>)}</select></F>
          <F label="Line of Treatment"><select className="input-brutal" value={line} onChange={e => setLine(e.target.value)}>{LINES.map(l => <option key={l}>{l}</option>)}</select></F>
        </div>
        <F label="Notes"><textarea className="input-brutal resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Give after food; avoid in pregnancy" /></F>
        <F label="Contraindications"><textarea className="input-brutal resize-none" rows={2} value={contra} onChange={e => setContra(e.target.value)} placeholder="Avoid in penicillin allergy" /></F>
      </div>

      <button type="submit" disabled={busy} className="btn-brutal flex items-center justify-center gap-2 w-full disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {busy ? "Saving…" : "Add Regimen"}
      </button>
    </form>
  );
}

// ── Admin: Manage ─────────────────────────────────────────────────────────────

// ── EditCell — click to edit inline ──────────────────────────────────────────

function EditCell({ value, onSave, saving, options }: { value: string; onSave: (v: string) => void; saving?: boolean; options?: string[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    if (options) {
      return (
        <select
          value={draft}
          onChange={e => { onSave(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === "Escape") setEditing(false); }}
          autoFocus
          className="w-full min-w-0 bg-primary/10 border border-primary px-1 py-0.5 text-[11px] outline-none"
        >
          <option value="">—</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        autoFocus
        className="w-full min-w-0 bg-primary/10 border border-primary px-1 py-0.5 text-[11px] outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`block w-full text-left px-1 py-0.5 hover:bg-primary/10 text-[11px] min-h-5 ${saving ? "opacity-40" : ""}`}
      title="Click to edit"
    >
      {saving ? "…" : (value || <span className="text-muted-foreground/25 select-none">—</span>)}
    </button>
  );
}

// ── Admin: Manage (inline table) ──────────────────────────────────────────────

const COLS: { key: string; label: string; px: number }[] = [
  { key: "adult_dose",        label: "Adult Dose", px: 130 },
  { key: "max_dose",          label: "Max Dose",   px: 90  },
  { key: "pediatric_dose",    label: "Peds Dose",  px: 120 },
  { key: "route",             label: "Route",      px: 70  },
  { key: "site",              label: "Site",       px: 100 },
  { key: "frequency",         label: "Freq",       px: 70  },
  { key: "duration",          label: "Duration",   px: 80  },
  { key: "strength",          label: "Strength",   px: 90  },
  { key: "formulation",       label: "Form",       px: 90  },
  { key: "line_of_treatment", label: "Line",       px: 100 },
  { key: "notes",             label: "Notes",      px: 160 },
  { key: "contraindications", label: "CI",         px: 140 },
];
const COL_OPTIONS: Record<string, string[]> = {
  route: ROUTES,
  site: INJECTION_SITES,
  frequency: FREQUENCIES,
  formulation: FORMULATIONS,
  line_of_treatment: LINES,
};
const COND_W = 160, DRUG_W = 150, DEL_W = 36;
const TABLE_W = COND_W + DRUG_W + COLS.reduce((s, c) => s + c.px, 0) + DEL_W;

// Shared cell/header bg helpers for sticky columns
const condBg = (stripe: boolean) => stripe ? "#f5f5f5" : "#ffffff";
const headBg = "#e8e8e8";

function AdminManage({ data, onRefresh }: { data: CacheData | null; onRefresh: () => void }) {
  const [filterQ, setFilterQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string>>({ line_of_treatment: "First line" });

  type FlatRow = Regimen & { condition_name: string; condition_id: string };

  const allRows = useMemo((): FlatRow[] => {
    if (!data) return [];
    return data.conditions.flatMap(c =>
      c.regimens.map(r => ({ ...r, condition_name: c.name, condition_id: c.id }))
    );
  }, [data]);

  const rows = useMemo(() => {
    const ql = filterQ.trim().toLowerCase();
    if (!ql) return allRows;
    return allRows.filter(r =>
      r.condition_name.toLowerCase().includes(ql) ||
      r.generic_name.toLowerCase().includes(ql)
    );
  }, [allRows, filterQ]);

  const pendingCount = Object.keys(pending).length;

  // Mark a cell as pending (changed but not yet saved)
  const markPending = (rid: string, field: string, value: string) => {
    setPending(p => ({ ...p, [rid]: { ...(p[rid] ?? {}), [field]: value } }));
  };

  // Save all pending changes at once
  const saveAll = async () => {
    if (!pendingCount) return;
    setSaving(true);
    setMsg(null);
    let errors = 0;
    for (const [rid, fields] of Object.entries(pending)) {
      try {
        await api(`/api/drug-reference/regimens/${rid}`, {
          method: "PUT",
          body: JSON.stringify(fields),
        });
      } catch {
        errors++;
      }
    }
    const savedCount = Object.keys(pending).length;
    setPending({});
    setSaving(false);
    if (errors) setMsg({ ok: false, text: `${errors} regimen(s) failed to save.` });
    else {
      setMsg({ ok: true, text: `Saved ${savedCount} regimen(s).` });
      onRefresh();
    }
  };

  const saveConditionName = async (conditionId: string, newName: string) => {
    const cond = data?.conditions.find(c => c.id === conditionId);
    if (!cond) return;
    await api(`/api/drug-reference/conditions/${conditionId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: newName,
        aliases: toArr(cond.aliases),
        category: cond.category || "",
        icd_code: cond.icd_code || "",
        notes: cond.notes || "",
      }),
    });
    onRefresh();
  };

  const saveDrugName = async (drugId: string, newName: string) => {
    const drug = data?.drugs.find(d => d.id === drugId);
    await api(`/api/drug-reference/drugs/${drugId}`, {
      method: "PUT",
      body: JSON.stringify({
        generic_name: newName,
        brand_names: drug ? toArr(drug.brand_names) : [],
        drug_class: drug?.drug_class || "",
        category: drug?.category || "",
      }),
    });
    onRefresh();
  };

  const deleteRow = async (rid: string) => {
    if (!confirm("Delete this regimen?")) return;
    try {
      await api(`/api/drug-reference/regimens/${rid}`, { method: "DELETE" });
      setPending(p => { const n = { ...p }; delete n[rid]; return n; });
      onRefresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? String(e.detail) : (e as Error).message });
    }
  };

  const addRow = async () => {
    const cname = newRow.condition_name?.trim();
    const dname = newRow.drug_name?.trim();
    if (!cname || !dname) { setMsg({ ok: false, text: "Condition name and drug name are required." }); return; }
    setSaving(true);
    setMsg(null);
    try {
      // Find or create condition using cached data
      let condId: string | null = data?.conditions.find(c => c.name.toLowerCase() === cname.toLowerCase())?.id ?? null;
      if (!condId) {
        const c = await api<{ id: string }>("/api/drug-reference/conditions", {
          method: "POST", body: JSON.stringify({ name: cname, aliases: [], category: newRow.condition_category ?? "", icd_code: "" }),
        });
        condId = c.id;
      }
      // Find or create drug using cached data
      let drugId: string | null = data?.drugs.find(d => d.generic_name.toLowerCase() === dname.toLowerCase())?.id ?? null;
      if (!drugId) {
        const d = await api<{ id: string }>("/api/drug-reference/drugs", {
          method: "POST", body: JSON.stringify({ generic_name: dname, brand_names: [], drug_class: newRow.drug_class ?? "" }),
        });
        drugId = d.id;
      }
      // Create regimen
      const body: Record<string, string> = { condition_id: condId!, drug_id: drugId! };
      for (const c of COLS) body[c.key] = newRow[c.key] ?? "";
      await api("/api/drug-reference/regimens", { method: "POST", body: JSON.stringify(body) });
      setAddingRow(false);
      setNewRow({ line_of_treatment: "First line" });
      onRefresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? String(e.detail) : (e as Error).message });
    } finally { setSaving(false); }
  };

  const thStyle = (left?: number): React.CSSProperties => ({
    position: "sticky",
    left: left !== undefined ? left : undefined,
    top: 0,
    zIndex: left !== undefined ? 40 : 30,
    background: headBg,
    whiteSpace: "nowrap",
  });

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`flex items-center gap-2 border-2 p-3 text-xs font-bold uppercase ${msg.ok ? "border-green-600 bg-green-50 text-green-800" : "border-destructive bg-destructive/10 text-destructive"}`}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input className="input-brutal w-full sm:flex-1 sm:min-w-48" placeholder="Filter by condition or drug…"
          value={filterQ} onChange={e => setFilterQ(e.target.value)} />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">{rows.length} rows</span>
          <button onClick={saveAll} disabled={saving || !pendingCount}
            className="btn-brutal flex items-center gap-1.5 text-xs px-4 py-2.5 disabled:opacity-50 min-h-[44px]">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : pendingCount > 0 ? `Save All (${pendingCount})` : "Save All"}
          </button>
          <button onClick={() => setAddingRow(v => !v)}
            className="border-2 border-border px-3 py-2.5 text-[11px] font-bold uppercase hover:bg-primary/10 flex items-center gap-1.5 min-h-[44px]">
            <Plus className="h-3.5 w-3.5" />
            Add Row
          </button>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
        Click any cell to edit · changes highlighted in amber · Save All to commit
      </p>

      {/* Add Row form */}
      {addingRow && (
        <div className="brutal p-4 bg-primary/5 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">New Regimen</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <F label="Condition Name *">
              <input className="input-brutal text-sm" value={newRow.condition_name ?? ""}
                onChange={e => setNewRow(r => ({ ...r, condition_name: e.target.value }))} autoFocus />
            </F>
            <F label="Drug Generic Name *">
              <input className="input-brutal text-sm" value={newRow.drug_name ?? ""}
                onChange={e => setNewRow(r => ({ ...r, drug_name: e.target.value }))} />
            </F>
            {COLS.map(c => {
              const val = newRow[c.key] ?? "";
              const set = (v: string) => setNewRow(r => ({ ...r, [c.key]: v }));
              if (c.key === "route") return (
                <F key={c.key} label={c.label}>
                  <select className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)}>
                    <option value="">Select</option>
                    {ROUTES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              );
              if (c.key === "site") return (
                <F key={c.key} label={c.label}>
                  <select className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)}>
                    <option value="">N/A</option>
                    {INJECTION_SITES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              );
              if (c.key === "frequency") return (
                <F key={c.key} label={c.label}>
                  <select className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)}>
                    <option value="">Select</option>
                    {FREQUENCIES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              );
              if (c.key === "formulation") return (
                <F key={c.key} label={c.label}>
                  <select className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)}>
                    <option value="">Select</option>
                    {FORMULATIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              );
              if (c.key === "line_of_treatment") return (
                <F key={c.key} label={c.label}>
                  <select className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)}>
                    {LINES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </F>
              );
              return (
                <F key={c.key} label={c.label}>
                  <input className="input-brutal text-sm" value={val} onChange={e => set(e.target.value)} />
                </F>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={addRow} disabled={saving}
              className="btn-brutal text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {saving ? "Saving…" : "Add Regimen"}
            </button>
            <button onClick={() => { setAddingRow(false); setNewRow({ line_of_treatment: "First line" }); }}
              className="border-2 border-border px-3 py-1.5 text-xs font-bold uppercase hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!data && <p className="text-[11px] text-muted-foreground p-2">Loading…</p>}

      <div className="border-2 border-border overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
        <table className="border-collapse text-[11px]" style={{ width: TABLE_W, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: COND_W }} />
            <col style={{ width: DRUG_W }} />
            {COLS.map(c => <col key={c.key} style={{ width: c.px }} />)}
            <col style={{ width: DEL_W }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle(0)} className="border-b-2 border-r border-border px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px]">Condition</th>
              <th style={thStyle(COND_W)} className="border-b-2 border-r border-border px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px]">Drug</th>
              {COLS.map(c => (
                <th key={c.key} style={thStyle()} className="border-b-2 border-r border-border px-2 py-2 text-left font-bold uppercase tracking-wide text-[10px]">
                  {c.label}
                </th>
              ))}
              <th style={thStyle()} className="border-b-2 border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const stripe = i % 2 === 1;
              const bg = condBg(stripe);
              const rowPending = pending[r.id] ?? {};
              return (
                <tr key={r.id} className="group">
                  <td style={{ position: "sticky", left: 0, zIndex: 10, background: bg }}
                    className="border-b border-r border-border/30 px-0 py-0">
                    <EditCell
                      value={r.condition_name}
                      onSave={v => saveConditionName(r.condition_id, v).catch(e =>
                        setMsg({ ok: false, text: e instanceof ApiError ? String(e.detail) : (e as Error).message })
                      )}
                    />
                  </td>
                  <td style={{ position: "sticky", left: COND_W, zIndex: 10, background: bg }}
                    className="border-b border-r border-border/30 px-0 py-0">
                    <EditCell
                      value={r.generic_name}
                      onSave={v => saveDrugName(r.drug_id, v).catch(e =>
                        setMsg({ ok: false, text: e instanceof ApiError ? String(e.detail) : (e as Error).message })
                      )}
                    />
                  </td>
                  {COLS.map(c => {
                    const isDirty = c.key in rowPending;
                    const currentVal = isDirty ? rowPending[c.key] : (r as unknown as Record<string, string>)[c.key] ?? "";
                    return (
                      <td key={c.key}
                        className={`border-b border-r border-border/30 py-0.5 ${isDirty ? "bg-amber-50" : ""}`}>
                        <EditCell
                          value={currentVal}
                          onSave={v => markPending(r.id, c.key, v)}
                          options={COL_OPTIONS[c.key]}
                        />
                      </td>
                    );
                  })}
                  <td className="border-b border-border/30 px-1 py-0.5 text-center">
                    <button onClick={() => deleteRow(r.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {data && rows.length === 0 && (
              <tr><td colSpan={COLS.length + 3} className="p-4 text-center text-[11px] text-muted-foreground">No regimens found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Admin: CSV ────────────────────────────────────────────────────────────────

function AdminCsv({ onSuccess }: { onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [result, setResult] = useState<{ updated?: number; inserted?: number; imported?: number; skipped: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [replaceAll, setReplaceAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setErr("");
    const reader = new FileReader();
    reader.onload = e => {
      const lines = (e.target?.result as string).split("\n").slice(0, 6);
      setPreview(lines.map(l => l.split(",").map(c => c.trim().slice(0, 30))));
    };
    reader.readAsText(f);
  };

  const upload = async () => {
    if (!file) return;
    if (replaceAll && !confirm("This will DELETE ALL existing drug reference data and reimport from this CSV. Are you sure?")) return;
    setBusy(true);
    setErr("");
    const url = replaceAll ? "/api/drug-reference/import/csv?replace=true" : "/api/drug-reference/import/csv";
    // Retry up to 3 times with 15 s gaps to survive Render cold starts
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (attempt > 1) setErr(`Server waking up… retrying (${attempt}/3)`);
        const res = await apiUpload<{ updated?: number; inserted?: number; imported?: number; skipped: number; errors: string[] }>(url, fd);
        setResult(res);
        setFile(null);
        setPreview(null);
        setReplaceAll(false);
        setErr("");
        onSuccess();
        setBusy(false);
        return;
      } catch (e) {
        const msg = e instanceof ApiError ? String(e.detail) : (e as Error).message;
        if (msg === "Failed to fetch" && attempt < 3) {
          await new Promise(r => setTimeout(r, 15000)); // wait 15 s then retry
          continue;
        }
        setErr(msg === "Failed to fetch"
          ? "Server unreachable after 3 attempts. Check your connection or try again in a minute."
          : msg);
        break;
      }
    }
    setBusy(false);
  };

  const downloadTemplate = () => {
    const cols = "condition_name,condition_aliases,condition_category,condition_icd_code,drug_generic_name,drug_brand_names,drug_class,adult_dose,pediatric_dose,route,frequency,duration,strength,formulation,line_of_treatment,notes,contraindications\n";
    const ex = "Upper Respiratory Tract Infection,URTI;Cold,Respiratory,J06.9,Azithromycin,Azee;Zithromax,Macrolide Antibiotic,500 mg OD,,Oral,OD,5 days,500 mg,Tablet,First line,Give after food,\n";
    const blob = new Blob([cols + ex], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "drug_reference_template.csv"; a.click();
  };

  const exportAll = async () => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/drug-reference/export/csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = await res.blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "drug_reference.csv"; a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={downloadTemplate} className="border-2 border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-primary/10 flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Download template
        </button>
        <button onClick={exportAll} className="border-2 border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-primary/10 flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export all
        </button>
      </div>

      {result && (
        <div className="brutal p-4 space-y-1">
          <div className="flex items-center gap-2 text-sm font-bold text-green-700">
            <CheckCircle2 className="h-4 w-4" /> Import complete
          </div>
          <p className="text-[12px]">
            {result.updated != null && <>Updated: <strong>{result.updated}</strong> · </>}
            {(result.inserted ?? result.imported) != null && <>New: <strong>{result.inserted ?? result.imported}</strong> · </>}
            Skipped: <strong>{result.skipped}</strong>
          </p>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.errors.map((e, i) => (
                <p key={i} className="text-[11px] text-destructive">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        className="cursor-pointer border-2 border-dashed border-border p-8 text-center hover:bg-primary/5"
      >
        <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-bold uppercase tracking-wide">
          {file ? file.name : "Drop CSV here or click to browse"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">.csv files only</p>
      </div>
      <input ref={fileRef} type="file" accept=".csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {preview && (
        <div className="brutal overflow-x-auto">
          <table className="w-full text-[11px]">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className={i === 0 ? "bg-secondary/20 font-bold" : ""}>
                  {row.slice(0, 6).map((cell, j) => (
                    <td key={j} className="border border-border px-2 py-1 whitespace-nowrap">{cell}</td>
                  ))}
                  {row.length > 6 && <td className="border border-border px-2 py-1 text-muted-foreground">…</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-[10px] text-muted-foreground">Preview (first 5 rows, 6 columns)</p>
        </div>
      )}

      {err && <p className="text-xs font-bold uppercase text-destructive">{err}</p>}

      {file && (
        <div className="space-y-3">
          <label className={`flex items-center gap-3 border-2 p-3 cursor-pointer transition-colors ${replaceAll ? "border-destructive bg-destructive/10" : "border-border hover:bg-muted/40"}`}>
            <input type="checkbox" checked={replaceAll} onChange={e => setReplaceAll(e.target.checked)}
              className="h-4 w-4 accent-destructive" />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-destructive">Replace All (wipe + reimport)</div>
              <div className="text-[10px] text-muted-foreground">Deletes ALL existing data first, then imports this CSV fresh</div>
            </div>
          </label>
          <button onClick={upload} disabled={busy}
            className={`flex items-center justify-center gap-2 w-full border-2 border-border font-bold uppercase text-sm px-4 py-3 disabled:opacity-50 ${replaceAll ? "bg-destructive text-white" : "btn-brutal"}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : replaceAll ? `⚠ Replace All with ${file.name}` : `Upload ${file.name}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Field helper ──────────────────────────────────────────────────────────────

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="brutal h-24 animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function DrugReferencePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<"lookup" | "admin">("lookup");
  const [adminSection, setAdminSection] = useState<"add" | "manage" | "csv">("manage");

  const [cache, setCache] = useState<CacheData | null>(null);
  const [loading, setLoading] = useState(true);

  // Lookup state
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "condition" | "drug">("all");
  const [activeCategory, setActiveCategory] = useState("");

  // Load and cache full dataset
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api<{ conditions: Condition[]; drugs: Drug[] }>("/api/drug-reference/search");
      const cacheData: CacheData = { ...data, cached_at: Date.now() };
      setCache(cacheData);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData)); } catch { /* quota */ }
    } catch {
      // silently fall back to cached data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Read localStorage immediately for instant display
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheData;
        setCache(parsed);
        setLoading(false);
        // Refresh in background if cache > 5 min old
        if (Date.now() - parsed.cached_at > 5 * 60 * 1000) loadData(true);
        return;
      }
    } catch { /* invalid cache */ }
    loadData();
  }, [loadData]);

  // Debounce search query
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const results = useMemo(() => {
    if (!cache) return { conditions: [], drugs: [] };
    return searchLocal(cache, debouncedQuery, filterType, activeCategory);
  }, [cache, debouncedQuery, filterType, activeCategory]);

  const hasResults = results.conditions.length > 0 || results.drugs.length > 0;
  const showSearch = !!debouncedQuery || !!activeCategory;

  return (
    <>
      <PageHeader
        title="Drug Reference"
        subtitle="Conditions · Drugs · Dosage guide"
        back="/tools"
        variant="yellow"
      />

      {/* Tab Bar */}
      <div className="sticky top-[57px] z-20 border-b-2 border-border bg-card flex">
        <button
          onClick={() => setTab("lookup")}
          className={`flex-1 py-3 text-[12px] font-bold uppercase tracking-widest border-r-2 border-border transition-colors min-h-[44px] ${tab === "lookup" ? "bg-primary" : "hover:bg-primary/10"}`}
        >
          Lookup
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab("admin")}
            className={`flex-1 py-3 text-[12px] font-bold uppercase tracking-widest transition-colors min-h-[44px] ${tab === "admin" ? "bg-primary" : "hover:bg-primary/10"}`}
          >
            Admin
          </button>
        )}
      </div>

      {tab === "lookup" && (
        <PageShell>
          <div className="space-y-4">
            {/* Search */}
            <div className="brutal flex items-center gap-2 bg-card px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                placeholder="Search condition, symptom, or drug name…"
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveCategory(""); }}
              />
              {query && (
                <button onClick={() => { setQuery(""); setDebouncedQuery(""); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Type Filter */}
            <div className="flex gap-1">
              {(["all", "condition", "drug"] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`border-2 border-border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${filterType === t ? "bg-primary" : "bg-card hover:bg-primary/20"}`}>
                  {t === "all" ? "All" : t === "condition" ? "Conditions" : "Drugs"}
                </button>
              ))}
            </div>

            {/* Category Chips */}
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(cat => (
                <button key={cat}
                  onClick={() => { setActiveCategory(activeCategory === cat ? "" : cat); setQuery(""); setDebouncedQuery(""); }}
                  className={`border-2 border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeCategory === cat ? "bg-primary" : "bg-card hover:bg-primary/20"}`}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Results */}
            {loading && !cache && <Skeleton />}

            {!loading && showSearch && !hasResults && (
              <div className="brutal p-6 text-center">
                <Pill className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="font-bold uppercase tracking-wide text-sm">No entries found for "{debouncedQuery || activeCategory}"</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Check spelling or try a synonym.{isAdmin && " Use Admin tab to add new entries."}</p>
              </div>
            )}

            {!showSearch && !loading && (
              <div className="brutal p-6 text-center">
                <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Search a condition or drug, or tap a category above
                </p>
              </div>
            )}

            {results.conditions.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Conditions ({results.conditions.length})
                </div>
                {results.conditions.map(c => <ConditionCard key={c.id} condition={c} />)}
              </div>
            )}

            {results.drugs.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Drugs ({results.drugs.length})
                </div>
                {results.drugs.map(d => <DrugCard key={d.id} drug={d} />)}
              </div>
            )}
          </div>
        </PageShell>
      )}

      {/* Admin uses full viewport width — rendered outside the narrow PageShell */}
      {tab === "admin" && isAdmin && (
        <main className="w-full px-4 pb-28 pt-4">
          <div className="space-y-4">
            <div className="flex border-2 border-border">
              {(["manage", "add", "csv"] as const).map(s => (
                <button key={s} onClick={() => setAdminSection(s)}
                  className={`flex-1 py-3 text-[12px] font-bold uppercase tracking-widest border-r last:border-r-0 border-border transition-colors min-h-[44px] ${adminSection === s ? "bg-secondary text-secondary-foreground" : "bg-card hover:bg-primary/10"}`}>
                  {s === "manage" ? "Edit Table" : s === "add" ? "Quick Add" : "CSV Import"}
                </button>
              ))}
            </div>
            {adminSection === "add" && (
              <div className="max-w-2xl">
                <AdminQuickAdd data={cache} onSuccess={() => loadData(true)} />
              </div>
            )}
            {adminSection === "manage" && (
              <AdminManage data={cache} onRefresh={() => loadData(true)} />
            )}
            {adminSection === "csv" && (
              <div className="max-w-2xl">
                <AdminCsv onSuccess={() => loadData(true)} />
              </div>
            )}
          </div>
        </main>
      )}
    </>
  );
}
