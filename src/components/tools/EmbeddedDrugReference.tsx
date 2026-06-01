import { useState, useEffect, useRef } from "react";
import { Pill, Search, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface Regimen {
  id: string;
  generic_name?: string;
  adult_dose?: string;
  pediatric_dose?: string;
  max_dose?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  strength?: string;
  line_of_treatment?: string;
  notes?: string;
  contraindications?: string;
  condition_name?: string;
}

interface ConditionResult {
  id: string;
  name: string;
  category?: string;
  icd_code?: string;
  regimens: Regimen[];
}

interface DrugResult {
  id: string;
  generic_name: string;
  brand_names?: string[];
  drug_class?: string;
  indications: Regimen[];
}

interface SearchResponse {
  conditions: ConditionResult[];
  drugs: DrugResult[];
}

function fmt(v: string | undefined | null) { return v || "—"; }

function RegimenRow({ r, showCondition }: { r: Regimen; showCondition?: boolean }) {
  return (
    <div className="border border-border bg-background px-3 py-2 space-y-0.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide">
          {showCondition ? fmt(r.condition_name) : fmt(r.generic_name)}
        </span>
        {r.line_of_treatment && (
          <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest shrink-0">
            {r.line_of_treatment}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-[10px] text-muted-foreground">
        {r.adult_dose && <span><b>Adult:</b> {r.adult_dose}</span>}
        {r.pediatric_dose && <span><b>Paed:</b> {r.pediatric_dose}</span>}
        {r.max_dose && <span><b>Max:</b> {r.max_dose}</span>}
        {r.route && <span><b>Route:</b> {r.route}</span>}
        {r.frequency && <span><b>Freq:</b> {r.frequency}</span>}
        {r.duration && <span><b>Duration:</b> {r.duration}</span>}
        {r.strength && <span><b>Strength:</b> {r.strength}</span>}
      </div>
      {r.notes && <p className="text-[10px] italic text-muted-foreground border-t border-border/40 pt-1">{r.notes}</p>}
      {r.contraindications && <p className="text-[10px] text-destructive font-bold">⚠ {r.contraindications}</p>}
    </div>
  );
}

function ConditionCard({ c }: { c: ConditionResult }) {
  const [open, setOpen] = useState(c.regimens.length <= 2);
  return (
    <div className="border-2 border-border">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted text-left">
        <div>
          <span className="text-sm font-bold">{c.name}</span>
          {c.icd_code && <span className="ml-2 text-[10px] text-muted-foreground font-mono">{c.icd_code}</span>}
          {c.category && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{c.category}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-muted-foreground">{c.regimens.length} regimen{c.regimens.length !== 1 ? "s" : ""}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>
      {open && c.regimens.length > 0 && (
        <div className="border-t border-border p-2 space-y-1.5">
          {c.regimens.map((r) => <RegimenRow key={r.id} r={r} />)}
        </div>
      )}
      {open && c.regimens.length === 0 && (
        <p className="px-3 py-2 text-[10px] text-muted-foreground">No regimens recorded.</p>
      )}
    </div>
  );
}

function DrugCard({ d }: { d: DrugResult }) {
  const [open, setOpen] = useState(d.indications.length <= 2);
  const brands = Array.isArray(d.brand_names) ? d.brand_names.join(", ") : d.brand_names ?? "";
  return (
    <div className="border-2 border-border">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted text-left">
        <div>
          <span className="text-sm font-bold">{d.generic_name}</span>
          {brands && <span className="ml-2 text-[10px] text-muted-foreground">({brands})</span>}
          {d.drug_class && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{d.drug_class}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-muted-foreground">{d.indications.length} indication{d.indications.length !== 1 ? "s" : ""}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>
      {open && d.indications.length > 0 && (
        <div className="border-t border-border p-2 space-y-1.5">
          {d.indications.map((r) => <RegimenRow key={r.id} r={r} showCondition />)}
        </div>
      )}
      {open && d.indications.length === 0 && (
        <p className="px-3 py-2 text-[10px] text-muted-foreground">No indications recorded.</p>
      )}
    </div>
  );
}

export function EmbeddedDrugReference() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debounceRef = useRef<any>(undefined);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setError(""); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/api/drug-reference/search?q=${encodeURIComponent(q)}&type=all`);
        if (!res.ok) throw new Error(`${res.status}`);
        setResults(await res.json() as SearchResponse);
      } catch (e) {
        setError(`Could not search — ${e instanceof Error ? e.message : "check connection"}.`);
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const totalResults = (results?.conditions.length ?? 0) + (results?.drugs.length ?? 0);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search condition or drug…"
          className="input-brutal w-full pl-8 pr-8"
        />
      </div>

      {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}

      {results && totalResults === 0 && !loading && (
        <p className="text-[10px] text-muted-foreground">No results for "{query}".</p>
      )}

      {results && totalResults > 0 && (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {results.conditions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Conditions ({results.conditions.length})
              </div>
              {results.conditions.map((c) => <ConditionCard key={c.id} c={c} />)}
            </div>
          )}
          {results.drugs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Drugs ({results.drugs.length})
              </div>
              {results.drugs.map((d) => <DrugCard key={d.id} d={d} />)}
            </div>
          )}
        </div>
      )}

      {query.trim().length < 2 && (
        <p className="text-[10px] text-muted-foreground">Type at least 2 characters — search by condition name, drug name, or drug class.</p>
      )}
    </div>
  );
}

export function EmbeddedDrugPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <Pill className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">Drug Reference — search conditions and drugs inline</span>
    </div>
  );
}
