import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";

export const Route = createFileRoute("/tools/nutrition")({ component: NutritionTool });

// ICMR-2020 RDA approximations. Reference-class only — round figures for MVP.
type Stage = "child-1-3" | "child-4-6" | "child-7-9" | "boy-10-12" | "girl-10-12" | "boy-13-15" | "girl-13-15" |
  "man-sed" | "man-mod" | "woman-sed" | "woman-mod" | "preg" | "lact-0-6";

const RDA: Record<Stage, { label: string; energy: number; protein: number; calcium: number; iron: number; vitA: number }> = {
  "child-1-3":  { label: "Child 1–3 y",        energy: 1110, protein: 12.5, calcium: 500, iron: 8,  vitA: 390 },
  "child-4-6":  { label: "Child 4–6 y",        energy: 1360, protein: 16,   calcium: 550, iron: 11, vitA: 510 },
  "child-7-9":  { label: "Child 7–9 y",        energy: 1700, protein: 23,   calcium: 650, iron: 15, vitA: 630 },
  "boy-10-12":  { label: "Boy 10–12 y",        energy: 2220, protein: 32,   calcium: 850, iron: 16, vitA: 770 },
  "girl-10-12": { label: "Girl 10–12 y",       energy: 2060, protein: 33,   calcium: 850, iron: 28, vitA: 790 },
  "boy-13-15":  { label: "Boy 13–15 y",        energy: 2860, protein: 45,   calcium: 1000, iron: 22, vitA: 930 },
  "girl-13-15": { label: "Girl 13–15 y",       energy: 2400, protein: 43,   calcium: 1000, iron: 30, vitA: 890 },
  "man-sed":    { label: "Adult man · sedentary",    energy: 2110, protein: 54,   calcium: 1000, iron: 19, vitA: 1000 },
  "man-mod":    { label: "Adult man · moderate",     energy: 2710, protein: 54,   calcium: 1000, iron: 19, vitA: 1000 },
  "woman-sed":  { label: "Adult woman · sedentary",  energy: 1660, protein: 46,   calcium: 1000, iron: 29, vitA: 840 },
  "woman-mod":  { label: "Adult woman · moderate",   energy: 2130, protein: 46,   calcium: 1000, iron: 29, vitA: 840 },
  "preg":       { label: "Pregnant woman",            energy: 2010, protein: 55.5, calcium: 1200, iron: 27, vitA: 900 },
  "lact-0-6":   { label: "Lactating · 0–6 mo",        energy: 2270, protein: 63.5, calcium: 1200, iron: 23, vitA: 950 },
};

function NutritionTool() {
  const [stage, setStage] = useState<Stage>("woman-sed");
  const [intake, setIntake] = useState({ energy: 0, protein: 0, calcium: 0, iron: 0, vitA: 0 });

  const r = RDA[stage];
  const rows = useMemo(
    () => [
      { key: "energy" as const, label: "Energy", unit: "kcal", target: r.energy },
      { key: "protein" as const, label: "Protein", unit: "g", target: r.protein },
      { key: "calcium" as const, label: "Calcium", unit: "mg", target: r.calcium },
      { key: "iron" as const, label: "Iron", unit: "mg", target: r.iron },
      { key: "vitA" as const, label: "Vit A", unit: "µg RE", target: r.vitA },
    ],
    [r],
  );

  return (
    <>
      <PageHeader title="Nutrition RDA" back="/tools" variant="yellow" subtitle="ICMR-NIN 2020" />
      <PageShell>
        <div className="brutal mb-4 p-4">
          <SectionTitle kicker="Stage">Demographic</SectionTitle>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="input-brutal font-bold uppercase tracking-wide"
          >
            {Object.entries(RDA).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="brutal-lg mb-4 bg-primary p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest">Daily allowance</div>
          <div className="mt-1 font-display text-3xl uppercase leading-none">{r.label}</div>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const v = intake[row.key];
            const pct = Math.min(100, Math.round((v / row.target) * 100));
            const tone =
              pct >= 90 ? "bg-success" : pct >= 60 ? "bg-primary" : "bg-destructive text-destructive-foreground";
            return (
              <div key={row.key} className="brutal p-3">
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-xl uppercase">{row.label}</div>
                  <div className="font-mono text-xs font-bold">
                    {row.target} {row.unit}/d
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    step={row.key === "energy" ? 50 : row.key === "calcium" || row.key === "vitA" ? 10 : 0.5}
                    value={v}
                    onChange={(e) => setIntake({ ...intake, [row.key]: Number(e.target.value) })}
                    className="input-brutal text-right font-mono"
                    placeholder="Intake"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wider">consumed</span>
                </div>
                <div className="mt-2 h-4 border-2 border-border bg-card">
                  <div className={`h-full ${tone} border-r-2 border-border`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>{pct}% of RDA</span>
                  <span>{v < row.target ? `Deficit ${(row.target - v).toFixed(1)} ${row.unit}` : "Met"}</span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Reference values approximated from ICMR-NIN RDA 2020. Verify with the official tables for clinical use.
        </p>
      </PageShell>
    </>
  );
}
