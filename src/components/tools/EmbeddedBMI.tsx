import { useMemo, useState, useEffect } from "react";
import { Scale, ChevronDown, ChevronUp } from "lucide-react";

function classifyBMI(bmi: number, sex: string) {
  const isAsian = !sex.toLowerCase().startsWith("f") || true; // use Asian by default; toggle by sex
  const female = sex.toLowerCase().startsWith("f");
  // Asian cutoffs (WHO 2004) — same for M/F
  if (bmi < 18.5) return { label: "Underweight", cls: "text-amber-600" };
  if (bmi < 23) return { label: "Normal", cls: "text-green-600" };
  if (bmi < 25) return { label: "Overweight", cls: "text-amber-600" };
  if (bmi < 27.5) return { label: isAsian ? "Obese I" : "Overweight", cls: "text-destructive" };
  return { label: "Obese II", cls: "text-destructive" };
  void female;
  void isAsian;
}

export interface EmbeddedBMIProps {
  onResult?: (bmi: number) => void;
  // Auto-feed: if provided, these override manual inputs and make it auto-calculated
  initialWeight?: number;
  initialHeight?: number;
  initialSex?: string;
  autoMode?: boolean; // true = auto-calculates from form fields, no manual entry needed
  // Age condition
  currentAgeYears?: number;
  ageConditionMin?: number;
}

export function EmbeddedBMI({
  onResult,
  initialWeight,
  initialHeight,
  initialSex = "",
  autoMode = false,
  currentAgeYears,
  ageConditionMin,
}: EmbeddedBMIProps) {
  const [weight, setWeight] = useState(initialWeight !== undefined ? String(initialWeight) : "");
  const [height, setHeight] = useState(initialHeight !== undefined ? String(initialHeight) : "");
  const [showManual, setShowManual] = useState(false);

  // Sync with form field changes in auto mode
  useEffect(() => {
    if (autoMode && initialWeight !== undefined) setWeight(String(initialWeight));
  }, [autoMode, initialWeight]);
  useEffect(() => {
    if (autoMode && initialHeight !== undefined) setHeight(String(initialHeight));
  }, [autoMode, initialHeight]);

  const bmi = useMemo(() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || h <= 0 || w <= 0) return null;
    return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
  }, [weight, height]);

  const classification = bmi !== null ? classifyBMI(bmi, initialSex) : null;

  // Age condition check
  const ageBlocked = ageConditionMin !== undefined && currentAgeYears !== undefined && currentAgeYears < ageConditionMin;
  if (ageBlocked) {
    return (
      <div className="border-2 border-border bg-muted/30 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <Scale className="inline h-3.5 w-3.5 mr-1.5" />
        BMI — not applicable (age &lt; {ageConditionMin} years)
      </div>
    );
  }

  // Auto-write result when bmi changes and we have a handler
  useEffect(() => {
    if (bmi !== null && onResult && autoMode) {
      onResult(bmi);
    }
  }, [bmi]); // eslint-disable-line react-hooks/exhaustive-deps

  // AUTO MODE: just show the result inline, no panel needed
  if (autoMode) {
    return (
      <div className="border-2 border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-primary">BMI</span>
          </div>
          {bmi !== null && classification ? (
            <div className="flex items-center gap-3">
              <span className="font-display text-2xl leading-none">{bmi.toFixed(1)}</span>
              <span className="text-[10px] text-muted-foreground">kg/m²</span>
              <span className={`text-xs font-bold uppercase tracking-wider ${classification.cls}`}>{classification.label}</span>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {!initialWeight ? "Enter weight above" : !initialHeight ? "Enter height above" : "—"}
            </span>
          )}
          <button type="button" onClick={() => setShowManual((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {showManual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showManual && (
          <div className="border-t-2 border-primary/20 p-4 space-y-3">
            <p className="text-[10px] text-muted-foreground">Override values manually if needed.</p>
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
            {bmi !== null && onResult && (
              <button type="button" onClick={() => onResult(bmi)} className="btn-brutal w-full text-xs">
                Use BMI {bmi.toFixed(1)}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // MANUAL MODE: expandable calculator (no source fields linked)
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
      {bmi !== null && classification ? (
        <div className="flex items-center justify-between gap-3 border-2 border-border bg-muted p-3">
          <div>
            <div className="font-display text-4xl leading-none">{bmi.toFixed(1)}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">kg/m²</div>
          </div>
          <div className={`text-sm font-bold uppercase tracking-wider ${classification.cls}`}>{classification.label}</div>
          {onResult && (
            <button type="button" onClick={() => onResult(bmi)} className="btn-brutal shrink-0 text-xs">Use {bmi.toFixed(1)}</button>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">Enter weight and height to calculate.</p>
      )}
    </div>
  );
}

export function EmbeddedBMIPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <Scale className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">BMI — auto-calculates from linked fields</span>
    </div>
  );
}
