import { useState, useEffect, useRef } from "react";
import { Pill, Search, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface DrugResult {
  drug_name: string;
  condition: string;
  dose_mg_per_kg?: number;
  dose_mg_per_kg_max?: number;
  max_dose_mg?: number;
  route: string;
  frequency: string;
  notes?: string;
  age_min_months?: number;
  age_max_months?: number;
  line_of_treatment?: string;
}

export function EmbeddedDrugReference() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debounceRef = useRef<any>(undefined);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setError(""); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/api/drugs/search?q=${encodeURIComponent(q)}&limit=8`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json() as DrugResult[];
        setResults(data);
      } catch {
        setError("Could not search — check connection.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drug or condition…"
          className="input-brutal w-full pl-8 pr-8"
        />
      </div>

      {error && <p className="text-[11px] font-bold text-destructive">{error}</p>}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="border-2 border-border bg-card p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-bold uppercase tracking-wide">{r.drug_name}</span>
                  {r.line_of_treatment && (
                    <span className="ml-2 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                      {r.line_of_treatment}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {r.route}
                </span>
              </div>

              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {r.condition}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                {r.dose_mg_per_kg !== undefined && (
                  <div>
                    <span className="font-bold">Dose: </span>
                    {r.dose_mg_per_kg}
                    {r.dose_mg_per_kg_max ? `–${r.dose_mg_per_kg_max}` : ""} mg/kg
                  </div>
                )}
                {r.max_dose_mg !== undefined && (
                  <div>
                    <span className="font-bold">Max: </span>{r.max_dose_mg} mg
                  </div>
                )}
                <div>
                  <span className="font-bold">Freq: </span>{r.frequency}
                </div>
                {(r.age_min_months !== undefined || r.age_max_months !== undefined) && (
                  <div>
                    <span className="font-bold">Age: </span>
                    {r.age_min_months !== undefined ? `${r.age_min_months}m` : "birth"}
                    {" – "}
                    {r.age_max_months !== undefined ? `${r.age_max_months}m` : "any"}
                  </div>
                )}
              </div>

              {r.notes && (
                <p className="text-[10px] italic text-muted-foreground border-t border-border/50 pt-1 mt-1">{r.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <p className="text-[10px] text-muted-foreground">No results found for "{query}".</p>
      )}

      {query.trim().length < 2 && (
        <p className="text-[10px] text-muted-foreground">Type at least 2 characters to search drugs.</p>
      )}
    </div>
  );
}

export function EmbeddedDrugPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <Pill className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">Drug Reference — tap to open</span>
    </div>
  );
}
