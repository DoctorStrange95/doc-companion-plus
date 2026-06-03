import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { useAuth } from "@/lib/auth";
import { AuthRequired } from "@/components/AuthGate";

export const Route = createFileRoute("/tools/sample-size")({ component: SampleSize });

type Mode = "single-prop" | "two-prop" | "single-mean" | "two-mean";

const Z = (p: number) => {
  // Inverse normal CDF approximation (Beasley-Springer-Moro)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
};

function SampleSize() {
  const { user } = useAuth();
  if (!user) return <AuthRequired action="use clinical tools" />;

  const [mode, setMode] = useState<Mode>("single-prop");
  const [alpha, setAlpha] = useState(0.05);
  const [power, setPower] = useState(0.8);

  // Single proportion
  const [p, setP] = useState(0.5);
  const [d, setD] = useState(0.05);
  // Two proportion
  const [p1, setP1] = useState(0.4);
  const [p2, setP2] = useState(0.5);
  // Single mean
  const [sigma, setSigma] = useState(10);
  const [mDelta, setMDelta] = useState(2);
  // Two mean
  const [sigma2, setSigma2] = useState(10);
  const [mDelta2, setMDelta2] = useState(3);

  // Finite population correction
  const [useFinite, setUseFinite] = useState(false);
  const [popN, setPopN] = useState(1000);

  // Non-response adjustment
  const [useResponse, setUseResponse] = useState(false);
  const [responseRate, setResponseRate] = useState(80);

  const result = useMemo(() => {
    const za = Z(1 - alpha / 2);
    const zb = Z(power);
    let nRaw: number;
    let formula: string;
    let inputs: string;

    if (mode === "single-prop") {
      nRaw = (za * za * p * (1 - p)) / (d * d);
      formula = "n = Z²·p(1−p) / d²";
      inputs = `p=${p}, d=${d}, α=${alpha}`;
    } else if (mode === "two-prop") {
      const pbar = (p1 + p2) / 2;
      const num = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
      nRaw = (num * num) / Math.pow(p1 - p2, 2);
      formula = "n = [Z_{α/2}√(2p̄q̄) + Z_β√(p₁q₁+p₂q₂)]² / (p₁−p₂)²";
      inputs = `p₁=${p1}, p₂=${p2}, α=${alpha}, power=${power} (per group)`;
    } else if (mode === "single-mean") {
      nRaw = Math.pow((za * sigma) / mDelta, 2);
      formula = "n = (Z·σ / d)²";
      inputs = `σ=${sigma}, d=${mDelta}, α=${alpha}`;
    } else {
      nRaw = (2 * Math.pow(za + zb, 2) * sigma2 * sigma2) / (mDelta2 * mDelta2);
      formula = "n = 2(Z_{α/2}+Z_β)²σ² / Δ²";
      inputs = `σ=${sigma2}, Δ=${mDelta2}, α=${alpha}, power=${power} (per group)`;
    }

    // Finite population correction: n_fpc = (n·N) / (n + N − 1)
    let nFpc = nRaw;
    if (useFinite && popN > 0 && nRaw < popN) {
      nFpc = (nRaw * popN) / (nRaw + popN - 1);
    }

    // Non-response adjustment: n_final = n_fpc / response_rate
    const rr = Math.max(0.01, Math.min(1, responseRate / 100));
    const nFinal = useResponse ? nFpc / rr : nFpc;

    return {
      nBase: Math.ceil(nRaw),
      nFpc: useFinite ? Math.ceil(nFpc) : null,
      nFinal: Math.ceil(nFinal),
      formula,
      inputs,
    };
  }, [mode, alpha, power, p, d, p1, p2, sigma, mDelta, sigma2, mDelta2, useFinite, popN, useResponse, responseRate]);

  const modes: { key: Mode; label: string }[] = [
    { key: "single-prop", label: "Single proportion" },
    { key: "two-prop", label: "Two proportions" },
    { key: "single-mean", label: "Single mean" },
    { key: "two-mean", label: "Two means" },
  ];

  return (
    <>
      <PageHeader title="Sample Size" back="/tools" variant="yellow" />
      <PageShell>
        <div className="brutal mb-4 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Study design</div>
          <div className="grid grid-cols-2 gap-2">
            {modes.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`border-2 border-border px-2 py-2 text-xs font-bold uppercase tracking-wide ${
                  mode === m.key ? "bg-primary" : "bg-card hover:bg-primary/30"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="brutal mb-4 space-y-3 p-4">
          <SectionTitle kicker="Inputs">Parameters</SectionTitle>
          <Row label="Significance α">
            <NumInput value={alpha} onChange={setAlpha} step={0.01} min={0.001} max={0.5} />
          </Row>
          {(mode === "two-prop" || mode === "two-mean") && (
            <Row label="Power (1−β)">
              <NumInput value={power} onChange={setPower} step={0.05} min={0.5} max={0.99} />
            </Row>
          )}

          {mode === "single-prop" && (
            <>
              <Row label="Expected proportion p"><NumInput value={p} onChange={setP} step={0.01} min={0.01} max={0.99} /></Row>
              <Row label="Margin of error d"><NumInput value={d} onChange={setD} step={0.01} min={0.001} max={0.5} /></Row>
            </>
          )}
          {mode === "two-prop" && (
            <>
              <Row label="Proportion p₁"><NumInput value={p1} onChange={setP1} step={0.01} min={0.01} max={0.99} /></Row>
              <Row label="Proportion p₂"><NumInput value={p2} onChange={setP2} step={0.01} min={0.01} max={0.99} /></Row>
            </>
          )}
          {mode === "single-mean" && (
            <>
              <Row label="Std. deviation σ"><NumInput value={sigma} onChange={setSigma} step={0.5} min={0.01} /></Row>
              <Row label="Margin of error d"><NumInput value={mDelta} onChange={setMDelta} step={0.5} min={0.01} /></Row>
            </>
          )}
          {mode === "two-mean" && (
            <>
              <Row label="Std. deviation σ"><NumInput value={sigma2} onChange={setSigma2} step={0.5} min={0.01} /></Row>
              <Row label="Difference to detect Δ"><NumInput value={mDelta2} onChange={setMDelta2} step={0.5} min={0.01} /></Row>
            </>
          )}
        </div>

        {/* Finite population correction */}
        <div className="brutal mb-4 space-y-3 p-4">
          <SectionTitle kicker="Optional">Adjustments</SectionTitle>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={useFinite} onChange={(e) => setUseFinite(e.target.checked)} className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Finite population correction</span>
          </label>
          {useFinite && (
            <Row label="Known population size N">
              <NumInput value={popN} onChange={setPopN} step={100} min={1} />
            </Row>
          )}
          {useFinite && (
            <p className="text-[10px] text-muted-foreground font-mono">n_adj = (n·N) / (n + N − 1)</p>
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={useResponse} onChange={(e) => setUseResponse(e.target.checked)} className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Adjust for non-response</span>
          </label>
          {useResponse && (
            <Row label="Expected response rate %">
              <NumInput value={responseRate} onChange={setResponseRate} step={5} min={1} max={100} />
            </Row>
          )}
          {useResponse && (
            <p className="text-[10px] text-muted-foreground font-mono">n_final = n / (response rate / 100)</p>
          )}
        </div>

        <div className="brutal-lg bg-primary p-5 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest">Required sample</div>
          <div className="font-display text-7xl uppercase leading-none">n = {result.nFinal}</div>
          {(result.nFpc !== null || useResponse) && (
            <div className="border-t border-black/20 pt-2 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">Calculation breakdown</div>
              <div className="text-[11px] font-mono">Base n = {result.nBase}</div>
              {result.nFpc !== null && (
                <div className="text-[11px] font-mono">After FPC = {result.nFpc}</div>
              )}
              {useResponse && (
                <div className="text-[11px] font-mono">After non-response ({responseRate}%) = {result.nFinal}</div>
              )}
            </div>
          )}
          <div className="border-t border-black/20 pt-2">
            <div className="font-mono text-[11px]">{result.formula}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider">{result.inputs}</div>
            {(mode === "two-prop" || mode === "two-mean") && (
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider">Total both groups = {result.nFinal * 2}</div>
            )}
          </div>
        </div>
      </PageShell>
    </>
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
