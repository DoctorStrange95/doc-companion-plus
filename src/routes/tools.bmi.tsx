import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";

export const Route = createFileRoute("/tools/bmi")({ component: BMITool });

function classifyAdult(bmi: number, asian: boolean) {
  if (asian) {
    if (bmi < 18.5) return { label: "Underweight", tone: "warning" as const };
    if (bmi < 23) return { label: "Normal", tone: "success" as const };
    if (bmi < 25) return { label: "Overweight (Asian)", tone: "warning" as const };
    if (bmi < 30) return { label: "Obese I", tone: "destructive" as const };
    return { label: "Obese II", tone: "destructive" as const };
  }
  if (bmi < 18.5) return { label: "Underweight", tone: "warning" as const };
  if (bmi < 25) return { label: "Normal", tone: "success" as const };
  if (bmi < 30) return { label: "Overweight", tone: "warning" as const };
  return { label: "Obese", tone: "destructive" as const };
}

function classifyMUAC(muac: number) {
  if (muac < 11.5) return { label: "Severe Acute Malnutrition (SAM)", tone: "destructive" as const };
  if (muac < 12.5) return { label: "Moderate Acute Malnutrition (MAM)", tone: "warning" as const };
  return { label: "Normal", tone: "success" as const };
}

function BMITool() {
  const [tab, setTab] = useState<"adult" | "muac">("adult");
  const [weight, setWeight] = useState(60);
  const [height, setHeight] = useState(165);
  const [asian, setAsian] = useState(true);
  const [muac, setMuac] = useState(13);

  const bmi = useMemo(() => {
    const m = height / 100;
    return weight / (m * m);
  }, [weight, height]);

  const ad = classifyAdult(bmi, asian);
  const mu = classifyMUAC(muac);

  return (
    <>
      <PageHeader title="BMI / MUAC" back="/tools" variant="yellow" />
      <PageShell>
        <div className="brutal mb-4 grid grid-cols-2">
          {[
            { k: "adult" as const, l: "Adult BMI" },
            { k: "muac" as const, l: "MUAC (6–59 mo)" },
          ].map((t, i) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-3 py-3 text-sm font-bold uppercase tracking-wide ${
                tab === t.k ? "bg-primary" : "bg-card hover:bg-primary/30"
              } ${i === 0 ? "border-r-2 border-border" : ""}`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {tab === "adult" ? (
          <>
            <div className="brutal space-y-3 p-4">
              <SectionTitle kicker="Inputs">Body</SectionTitle>
              <Row label="Weight (kg)">
                <NumInput value={weight} onChange={setWeight} step={0.1} min={1} />
              </Row>
              <Row label="Height (cm)">
                <NumInput value={height} onChange={setHeight} step={0.5} min={30} />
              </Row>
              <label className="flex items-center justify-between gap-3 pt-2">
                <span className="text-xs font-bold uppercase tracking-wider">Asian cutoffs</span>
                <input
                  type="checkbox"
                  checked={asian}
                  onChange={(e) => setAsian(e.target.checked)}
                  className="h-5 w-5 border-2 border-border accent-yellow-300"
                />
              </label>
            </div>
            <ResultCard
              big={bmi.toFixed(1)}
              caption="kg/m²"
              label={ad.label}
              tone={ad.tone}
              note={asian ? "Asian-Pacific cutoffs (WHO 2004)" : "WHO international cutoffs"}
            />
          </>
        ) : (
          <>
            <div className="brutal space-y-3 p-4">
              <SectionTitle kicker="Inputs">MUAC</SectionTitle>
              <Row label="Mid-upper arm circumference (cm)">
                <NumInput value={muac} onChange={setMuac} step={0.1} min={5} max={30} />
              </Row>
            </div>
            <ResultCard
              big={muac.toFixed(1)}
              caption="cm"
              label={mu.label}
              tone={mu.tone}
              note="WHO 2009: <11.5 SAM · 11.5–12.4 MAM · ≥12.5 normal"
            />
          </>
        )}
      </PageShell>
    </>
  );
}

function ResultCard({
  big, caption, label, tone, note,
}: {
  big: string; caption: string; label: string; note: string;
  tone: "success" | "warning" | "destructive";
}) {
  const bg =
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-primary" : "bg-destructive text-destructive-foreground";
  return (
    <div className={`brutal-lg mt-4 p-5 ${bg}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">Result</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-7xl uppercase leading-none">{big}</span>
        <span className="text-sm font-bold uppercase tracking-widest">{caption}</span>
      </div>
      <div className="mt-3 font-display text-2xl uppercase leading-none">{label}</div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider opacity-90">{note}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      <div className="w-32">{children}</div>
    </label>
  );
}

function NumInput({
  value, onChange, step = 1, min, max,
}: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input-brutal text-right font-mono"
    />
  );
}
