import { useMemo, useState } from "react";
import { Scale } from "lucide-react";

function classifyBMI(bmi: number, asian: boolean) {
  if (asian) {
    if (bmi < 18.5) return { label: "Underweight", cls: "text-amber-600 dark:text-amber-400" };
    if (bmi < 23) return { label: "Normal", cls: "text-green-600 dark:text-green-400" };
    if (bmi < 25) return { label: "Overweight", cls: "text-amber-600 dark:text-amber-400" };
    if (bmi < 30) return { label: "Obese I", cls: "text-destructive" };
    return { label: "Obese II", cls: "text-destructive" };
  }
  if (bmi < 18.5) return { label: "Underweight", cls: "text-amber-600 dark:text-amber-400" };
  if (bmi < 25) return { label: "Normal", cls: "text-green-600 dark:text-green-400" };
  if (bmi < 30) return { label: "Overweight", cls: "text-amber-600 dark:text-amber-400" };
  return { label: "Obese", cls: "text-destructive" };
}

interface EmbeddedBMIProps {
  onResult?: (bmi: number) => void;
}

export function EmbeddedBMI({ onResult }: EmbeddedBMIProps) {
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [asian, setAsian] = useState(true);

  const bmi = useMemo(() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || h <= 0 || w <= 0) return null;
    const m = h / 100;
    return Math.round((w / (m * m)) * 10) / 10;
  }, [weight, height]);

  const classification = bmi !== null ? classifyBMI(bmi, asian) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Weight (kg)
          </label>
          <input
            type="number"
            step="0.1"
            min="1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="input-brutal font-mono"
            placeholder="60"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Height (cm)
          </label>
          <input
            type="number"
            step="0.5"
            min="30"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="input-brutal font-mono"
            placeholder="165"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
        <input
          type="checkbox"
          checked={asian}
          onChange={(e) => setAsian(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Asian cutoffs (WHO 2004)
      </label>

      {bmi !== null && classification && (
        <div className="flex items-center justify-between gap-3 border-2 border-border bg-muted p-3">
          <div>
            <div className="font-display text-4xl leading-none">{bmi.toFixed(1)}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">kg/m²</div>
          </div>
          <div className={`text-right text-sm font-bold uppercase tracking-wider ${classification.cls}`}>
            {classification.label}
          </div>
          {onResult && (
            <button
              type="button"
              onClick={() => onResult(bmi)}
              className="btn-brutal shrink-0 text-xs"
            >
              Use {bmi.toFixed(1)}
            </button>
          )}
        </div>
      )}

      {!bmi && (
        <p className="text-[10px] text-muted-foreground">Enter weight and height above to calculate.</p>
      )}
    </div>
  );
}

export function EmbeddedBMIPreview() {
  return (
    <div className="mt-2 flex items-center gap-2 border-2 border-dashed border-border px-3 py-2 pointer-events-none select-none">
      <Scale className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-bold text-muted-foreground">BMI Calculator — tap to open</span>
    </div>
  );
}
