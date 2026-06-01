import { useMemo, useState, useEffect } from "react";
import { TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { computeVisitZScores, applyPositionCorrection } from "@/lib/who-lms";

function zText(z: number | null) {
  if (z === null) return "—";
  return (z > 0 ? "+" : "") + z.toFixed(2);
}

function zColorCls(z: number | null): string {
  if (z === null) return "text-muted-foreground";
  if (z < -3 || z > 3) return "text-destructive font-bold";
  if (z < -2 || z > 2) return "text-amber-600 font-bold";
  return "text-green-600 font-bold";
}

function nutritionLabel(waz: number | null, haz: number | null, whz: number | null, isSAM: boolean, isMAM: boolean) {
  if (isSAM) return { label: "SAM", cls: "bg-destructive text-destructive-foreground" };
  if (isMAM) return { label: "MAM", cls: "bg-amber-500 text-white" };
  if ((whz !== null && whz < -1) || (waz !== null && waz < -1)) return { label: "At risk", cls: "bg-primary" };
  return { label: "Normal", cls: "bg-green-500 text-white" };
}

export interface EmbeddedGrowthChartProps {
  onResult?: (r: { waz: number | null; haz: number | null; whz: number | null; label: string }) => void;
  initialWeight?: number;
  initialHeight?: number;
  initialAgeMonths?: number;
  initialSex?: string;
  autoMode?: boolean;
}

export function EmbeddedGrowthChart({
  onResult,
  initialWeight,
  initialHeight,
  initialAgeMonths,
  initialSex = "",
  autoMode = false,
}: EmbeddedGrowthChartProps) {
  const [weight, setWeight] = useState(initialWeight !== undefined ? String(initialWeight) : "");
  const [height, setHeight] = useState(initialHeight !== undefined ? String(initialHeight) : "");
  const [ageMonths, setAgeMonths] = useState(initialAgeMonths !== undefined ? String(initialAgeMonths) : "");
  const [sex, setSex] = useState<"M" | "F">(initialSex.toLowerCase().startsWith("f") ? "F" : "M");
  const [showManual, setShowManual] = useState(false);

  // Sync with form field changes in auto mode
  useEffect(() => { if (autoMode && initialWeight !== undefined) setWeight(String(initialWeight)); }, [autoMode, initialWeight]);
  useEffect(() => { if (autoMode && initialHeight !== undefined) setHeight(String(initialHeight)); }, [autoMode, initialHeight]);
  useEffect(() => { if (autoMode && initialAgeMonths !== undefined) setAgeMonths(String(initialAgeMonths)); }, [autoMode, initialAgeMonths]);
  useEffect(() => {
    if (autoMode && initialSex) setSex(initialSex.toLowerCase().startsWith("f") ? "F" : "M");
  }, [autoMode, initialSex]);

  const ageNum = parseFloat(ageMonths);

  // Block for adults (> 60 months = 5 years)
  const isAdult = !isNaN(ageNum) && ageNum > 60;

  const result = useMemo(() => {
    const age = parseFloat(ageMonths);
    const wt = parseFloat(weight);
    const ht = parseFloat(height);
    if (!age || !wt || !ht || age <= 0 || wt <= 0 || ht <= 0 || age > 60) return null;
    const correctedHt = applyPositionCorrection(ht, age, age < 24);
    return computeVisitZScores(sex, age, wt, correctedHt, undefined, false);
  }, [ageMonths, weight, height, sex]);

  const nutLabel = result ? nutritionLabel(result.waz, result.haz, result.whz, result.isSAM, result.isMAM) : null;

  // Auto-write when result changes
  useEffect(() => {
    if (result && onResult && autoMode) {
      onResult({
        waz: result.waz,
        haz: result.haz,
        whz: result.whz,
        label: nutLabel?.label ?? "Normal",
      });
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // AUTO MODE — inline result, always visible
  if (autoMode) {
    if (isAdult) {
      return (
        <div className="border-2 border-border bg-muted/30 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <TrendingUp className="inline h-3.5 w-3.5 mr-1.5" />
          Growth chart — not applicable (age &gt; 5 years)
        </div>
      );
    }

    return (
      <div className="border-2 border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-primary">Growth (WHO)</span>
          </div>

          {result && nutLabel ? (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="flex gap-2 text-[10px]">
                <span>WAZ <span className={zColorCls(result.waz)}>{zText(result.waz)}</span></span>
                <span>HAZ <span className={zColorCls(result.haz)}>{zText(result.haz)}</span></span>
                <span>WHZ <span className={zColorCls(result.whz)}>{zText(result.whz)}</span></span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${nutLabel.cls}`}>{nutLabel.label}</span>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {!ageMonths ? "Enter age above" : !weight ? "Enter weight" : !height ? "Enter height" : "Calculating…"}
            </span>
          )}

          <button type="button" onClick={() => setShowManual((v) => !v)} className="text-muted-foreground hover:text-foreground shrink-0">
            {showManual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showManual && (
          <div className="border-t-2 border-primary/20 p-4 space-y-3">
            <p className="text-[10px] text-muted-foreground">Override values or check z-scores in detail.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(["M", "F"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSex(s)}
                  className={`border-2 border-border py-2 text-xs font-bold uppercase tracking-widest ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                  {s === "M" ? "Male" : "Female"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[["Age (mo)", ageMonths, setAgeMonths], ["Weight (kg)", weight, setWeight], ["Height (cm)", height, setHeight]].map(([label, val, setter]) => (
                <div key={label as string}>
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label as string}</label>
                  <input type="number" step="any" value={val as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} className="input-brutal font-mono text-sm" />
                </div>
              ))}
            </div>
            {result && onResult && (
              <button type="button" onClick={() => onResult({ waz: result.waz, haz: result.haz, whz: result.whz, label: nutLabel?.label ?? "Normal" })}
                className="btn-brutal w-full text-xs">
                Use these z-scores
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // MANUAL MODE — expandable panel (no source fields linked)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["M", "F"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSex(s)}
            className={`border-2 border-border py-2 text-xs font-bold uppercase tracking-widest ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
            {s === "M" ? "Male" : "Female"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[["Age (months)", ageMonths, setAgeMonths, 0, 60], ["Weight (kg)", weight, setWeight, 0, 999], ["Height (cm)", height, setHeight, 0, 999]].map(([label, val, setter, min, max]) => (
          <div key={label as string}>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label as string}</label>
            <input type="number" step="any" min={min as number} max={max as number} value={val as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} className="input-brutal font-mono" />
          </div>
        ))}
      </div>

      {isAdult && <p className="text-[11px] font-bold text-amber-600">WHO Growth Standards apply to children 0–60 months only.</p>}

      {result && nutLabel && (
        <div className="border-2 border-border bg-muted p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["WAZ", result.waz, result.wazLabel], ["HAZ", result.haz, result.hazLabel], ["WHZ", result.whz, ""]].map(([lbl, z, desc]) => (
              <div key={lbl as string} className="border border-border bg-card p-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{lbl as string}</div>
                <div className={`font-display text-xl leading-none mt-1 ${zColorCls(z as number | null)}`}>{zText(z as number | null)}</div>
                {desc && <div className="text-[9px] text-muted-foreground mt-0.5">{desc as string}</div>}
              </div>
            ))}
          </div>
          <div className={`px-3 py-2 text-xs font-bold uppercase tracking-wider text-center ${nutLabel.cls}`}>{nutLabel.label}</div>
          {onResult && (
            <button type="button" onClick={() => onResult({ waz: result.waz, haz: result.haz, whz: result.whz, label: nutLabel.label })}
              className="btn-brutal w-full text-xs">Use these z-scores</button>
          )}
        </div>
      )}
      {!result && !isAdult && <p className="text-[10px] text-muted-foreground">Enter age (0–60 months), weight, and height.</p>}
    </div>
  );
}

export function EmbeddedGrowthPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">Growth Chart — auto-calculates from linked fields</span>
    </div>
  );
}
