import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { computeVisitZScores, applyPositionCorrection } from "@/lib/who-lms";

interface ZResult {
  waz: number | null;
  haz: number | null;
  whz: number | null;
  hazLabel: string;
  wazLabel: string;
  isSAM: boolean;
  isMAM: boolean;
  samCriteria: string;
}

function zText(z: number | null) {
  if (z === null) return "—";
  return (z > 0 ? "+" : "") + z.toFixed(2);
}

function zColor(z: number | null): string {
  if (z === null) return "text-muted-foreground";
  if (z < -3 || z > 3) return "text-destructive";
  if (z < -2 || z > 2) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

interface EmbeddedGrowthChartProps {
  onResult?: (results: { waz: number | null; haz: number | null; whz: number | null; label: string }) => void;
}

export function EmbeddedGrowthChart({ onResult }: EmbeddedGrowthChartProps) {
  const [ageMonths, setAgeMonths] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [isLying, setIsLying] = useState(false);
  const [muac, setMuac] = useState("");

  const result: ZResult | null = useMemo(() => {
    const age = parseFloat(ageMonths);
    const wt = parseFloat(weight);
    const ht = parseFloat(height);
    if (!age || !wt || !ht || age < 0 || wt <= 0 || ht <= 0) return null;
    const correctedHt = applyPositionCorrection(ht, age, isLying);
    const muacVal = muac ? parseFloat(muac) : undefined;
    return computeVisitZScores(sex, age, wt, correctedHt, muacVal, false);
  }, [ageMonths, weight, height, sex, isLying, muac]);

  const nutritionLabel = result
    ? result.isSAM
      ? "SAM"
      : result.isMAM
        ? "MAM"
        : "Normal"
    : null;

  return (
    <div className="space-y-3">
      {/* Sex */}
      <div className="grid grid-cols-2 gap-2">
        {(["M", "F"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSex(s)}
            className={`border-2 border-border py-2 text-xs font-bold uppercase tracking-widest transition-colors ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
          >
            {s === "M" ? "Male" : "Female"}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Age (months)</label>
          <input
            type="number"
            min="0"
            max="60"
            value={ageMonths}
            onChange={(e) => setAgeMonths(e.target.value)}
            className="input-brutal font-mono"
            placeholder="24"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="input-brutal font-mono"
            placeholder="12"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Height (cm)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="input-brutal font-mono"
            placeholder="85"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">MUAC (cm) — optional</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={muac}
            onChange={(e) => setMuac(e.target.value)}
            className="input-brutal font-mono"
            placeholder="13.5"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
            <input
              type="checkbox"
              checked={isLying}
              onChange={(e) => setIsLying(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Lying (length)
          </label>
        </div>
      </div>

      {result && (
        <div className="border-2 border-border bg-muted p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "WAZ", val: result.waz, desc: result.wazLabel },
              { label: "HAZ", val: result.haz, desc: result.hazLabel },
              { label: "WHZ", val: result.whz, desc: "" },
            ].map(({ label, val, desc }) => (
              <div key={label} className="border border-border bg-card p-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
                <div className={`font-display text-xl leading-none mt-1 ${zColor(val)}`}>{zText(val)}</div>
                {desc && <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{desc}</div>}
              </div>
            ))}
          </div>

          {(result.isSAM || result.isMAM) && (
            <div className={`border-2 px-3 py-2 text-xs font-bold uppercase tracking-wider ${result.isSAM ? "border-destructive bg-destructive/10 text-destructive" : "border-amber-500 bg-amber-50 text-amber-700"}`}>
              {result.isSAM ? `SAM — ${result.samCriteria}` : "MAM — Moderate Acute Malnutrition"}
            </div>
          )}

          {onResult && (
            <button
              type="button"
              onClick={() => onResult({
                waz: result.waz,
                haz: result.haz,
                whz: result.whz,
                label: nutritionLabel ?? "Normal",
              })}
              className="btn-brutal w-full text-xs"
            >
              Use these z-scores
            </button>
          )}
        </div>
      )}

      {!result && (
        <p className="text-[10px] text-muted-foreground">Enter age, weight, and height to calculate z-scores.</p>
      )}
    </div>
  );
}

export function EmbeddedGrowthPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">Growth Chart — tap to open</span>
    </div>
  );
}
