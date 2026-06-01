import { useMemo, useState, useEffect } from "react";
import { Scale, ChevronDown, ChevronUp } from "lucide-react";
import { classifyBMIByAge } from "@/lib/who-bmi-2007";

/** Approximate percentile from z-score (normal CDF) */
function zToPercentile(z: number): string {
  if (!Number.isFinite(z)) return "";
  // Abramowitz & Stegun approximation
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989423 * Math.exp(-0.5 * absZ * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - d * poly;
  const p = z >= 0 ? cdf : 1 - cdf;
  const pct = Math.round(p * 10) / 10;
  if (pct < 0.1) return "<0.1th";
  if (pct > 99.9) return ">99.9th";
  return `${pct}th`;
}

export interface EmbeddedBMIProps {
  onResult?: (bmi: number) => void;
  initialWeight?: number;
  initialHeight?: number;
  initialSex?: string;
  // age in months — determines which reference to use
  initialAgeMonths?: number;
  autoMode?: boolean;
}

export function EmbeddedBMI({
  onResult,
  initialWeight,
  initialHeight,
  initialSex = "",
  initialAgeMonths,
  autoMode = false,
}: EmbeddedBMIProps) {
  const [weight, setWeight] = useState(initialWeight !== undefined ? String(initialWeight) : "");
  const [height, setHeight] = useState(initialHeight !== undefined ? String(initialHeight) : "");
  const [showManual, setShowManual] = useState(false);

  useEffect(() => { if (autoMode && initialWeight !== undefined) setWeight(String(initialWeight)); }, [autoMode, initialWeight]);
  useEffect(() => { if (autoMode && initialHeight !== undefined) setHeight(String(initialHeight)); }, [autoMode, initialHeight]);

  const bmi = useMemo(() => {
    const w = parseFloat(weight), h = parseFloat(height);
    if (!w || !h || h <= 0 || w <= 0) return null;
    return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
  }, [weight, height]);

  // Use age-appropriate classification
  const ageMonths = initialAgeMonths;
  const result = useMemo(() => {
    if (bmi === null) return null;
    // No age → adult fallback
    const age = ageMonths ?? 999;
    if (age < 61) return null; // Growth Chart range — not applicable
    return classifyBMIByAge(bmi, age, initialSex);
  }, [bmi, ageMonths, initialSex]);

  const isGrowthChartRange = ageMonths !== undefined && ageMonths < 61;
  const percentile = result && Number.isFinite(result.z) ? zToPercentile(result.z) : null;

  useEffect(() => {
    if (bmi !== null && result && onResult && autoMode) onResult(bmi);
  }, [bmi]); // eslint-disable-line react-hooks/exhaustive-deps

  // AUTO MODE
  if (autoMode) {
    if (isGrowthChartRange) {
      return (
        <div className="flex items-center gap-2 border-2 border-border bg-muted/30 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Scale className="h-3.5 w-3.5 shrink-0" />
          BMI — Growth Chart range (&lt; 5 years). Use Growth Chart tool above.
        </div>
      );
    }

    return (
      <div className="border-2 border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-primary">BMI</span>
            {result && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{result.ageRange}</span>}
          </div>
          {bmi !== null && result ? (
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <span className="font-display text-2xl leading-none">{bmi.toFixed(1)}</span>
              <div className="text-right">
                <div className={`text-xs font-bold uppercase tracking-wider ${result.cls}`}>{result.label}</div>
                {percentile && <div className="text-[9px] text-muted-foreground">{percentile} percentile {Number.isFinite(result.z) ? `(z ${result.z > 0 ? "+" : ""}${result.z.toFixed(2)})` : ""}</div>}
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {!initialWeight ? "Enter weight" : !initialHeight ? "Enter height" : "—"}
            </span>
          )}
          <button type="button" onClick={() => setShowManual((v) => !v)} className="text-muted-foreground hover:text-foreground shrink-0">
            {showManual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showManual && (
          <div className="border-t-2 border-primary/20 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Weight (kg)</label>
                <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} className="input-brutal font-mono" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Height (cm)</label>
                <input type="number" step="0.5" value={height} onChange={(e) => setHeight(e.target.value)} className="input-brutal font-mono" />
              </div>
            </div>
            {bmi !== null && result && onResult && (
              <button type="button" onClick={() => onResult(bmi)} className="btn-brutal w-full text-xs">Use BMI {bmi.toFixed(1)}</button>
            )}
          </div>
        )}
      </div>
    );
  }

  // MANUAL MODE
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Weight (kg)</label>
          <input type="number" step="0.1" min="1" value={weight} onChange={(e) => setWeight(e.target.value)} className="input-brutal font-mono" placeholder="60" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Height (cm)</label>
          <input type="number" step="0.5" min="30" value={height} onChange={(e) => setHeight(e.target.value)} className="input-brutal font-mono" placeholder="165" />
        </div>
      </div>

      {isGrowthChartRange && (
        <p className="text-[11px] text-amber-600 font-bold">Age &lt; 5 years — use Growth Chart tool for weight-for-height z-score.</p>
      )}

      {bmi !== null && result ? (
        <div className="border-2 border-border bg-muted p-3 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-4xl leading-none">{bmi.toFixed(1)}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">kg/m²</div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-bold uppercase tracking-wider ${result.cls}`}>{result.label}</div>
              {percentile && <div className="text-[10px] text-muted-foreground">{percentile} percentile</div>}
              {Number.isFinite(result.z) && <div className="text-[10px] text-muted-foreground">z = {result.z > 0 ? "+" : ""}{result.z.toFixed(2)}</div>}
              <div className="text-[9px] text-muted-foreground mt-0.5">{result.ageRange}</div>
            </div>
            {onResult && <button type="button" onClick={() => onResult(bmi)} className="btn-brutal shrink-0 text-xs">Use {bmi.toFixed(1)}</button>}
          </div>
          {/* Simple percentile band bar */}
          {Number.isFinite(result.z) && <PercentileBandBar z={result.z} />}
        </div>
      ) : bmi !== null && !result && !isGrowthChartRange ? (
        <p className="text-[10px] text-muted-foreground">Age needed for classification. Link an age field in the tool settings.</p>
      ) : !bmi ? (
        <p className="text-[10px] text-muted-foreground">Enter weight and height to calculate.</p>
      ) : null}
    </div>
  );
}

/** Visual band bar showing where the z-score falls */
function PercentileBandBar({ z }: { z: number }) {
  // Map z from -4 to +4 to a percentage 0-100
  const pct = Math.min(100, Math.max(0, ((z + 4) / 8) * 100));
  const bands = [
    { label: "Severely thin", width: "12.5%", cls: "bg-red-400" },     // < -3
    { label: "Thin", width: "12.5%", cls: "bg-amber-400" },             // -3 to -2
    { label: "Normal", width: "37.5%", cls: "bg-green-400" },           // -2 to +1
    { label: "Overweight risk", width: "12.5%", cls: "bg-amber-300" },  // +1 to +2
    { label: "Obese", width: "25%", cls: "bg-red-300" },                // > +2
  ];
  return (
    <div className="space-y-1 mt-1">
      <div className="flex h-3 w-full overflow-hidden border border-border">
        {bands.map((b) => <div key={b.label} className={b.cls} style={{ width: b.width }} />)}
      </div>
      <div className="relative h-3 w-full">
        <div
          className="absolute top-0 h-3 w-0.5 bg-foreground"
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="flex justify-between text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
        <span>&lt;3rd</span><span>15th</span><span>50th</span><span>85th</span><span>97th</span>
      </div>
    </div>
  );
}

export function EmbeddedBMIPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <Scale className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">BMI — WHO 2007 (5–19 yrs) · Adult (≥19 yrs)</span>
    </div>
  );
}
