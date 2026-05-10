import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  charts,
  refTables,
  interpolated,
  classify,
  type ChartKey,
  type Sex,
} from "@/lib/who-growth";

export const Route = createFileRoute("/tools/growth")({ component: GrowthTool });

interface Pt {
  x: number;
  y: number;
}

const chartOrder: ChartKey[] = ["wfa", "hfa", "wfh", "bfa", "muac", "hcfa"];

function GrowthTool() {
  const [chartKey, setChartKey] = useState<ChartKey>("wfa");
  const [sex, setSex] = useState<Sex>("boys");
  const meta = charts[chartKey];

  // Per-chart inputs and points (preserved across tab switches)
  const [pointsByChart, setPointsByChart] = useState<Record<ChartKey, Pt[]>>(() =>
    Object.fromEntries(chartOrder.map((k) => [k, []])) as Record<ChartKey, Pt[]>,
  );
  const points = pointsByChart[chartKey];

  const [xVal, setXVal] = useState<number>(initialX(chartKey));
  const [yVal, setYVal] = useState<number>(initialY(chartKey));

  const ref = refTables[chartKey][sex];

  const data = useMemo(() => {
    const map = new Map<
      number,
      { x: number; SDneg2: number; median: number; SDpos2: number; child?: number }
    >();
    ref.forEach((r) =>
      map.set(r.x, { x: r.x, SDneg2: r.SDneg2, median: r.median, SDpos2: r.SDpos2 }),
    );
    points.forEach((p) => {
      const base = map.get(p.x) ?? interpolated(ref, p.x);
      map.set(p.x, {
        x: p.x,
        SDneg2: base.SDneg2,
        median: base.median,
        SDpos2: base.SDpos2,
        child: p.y,
      });
    });
    return Array.from(map.values()).sort((a, b) => a.x - b.x);
  }, [ref, points]);

  const cls = useMemo(() => {
    const i = interpolated(ref, xVal);
    return classify(chartKey, i, yVal);
  }, [ref, xVal, yVal, chartKey]);

  const switchChart = (k: ChartKey) => {
    setChartKey(k);
    setXVal(initialX(k));
    setYVal(initialY(k));
  };

  const addPoint = () => {
    setPointsByChart((prev) => {
      const arr = (prev[chartKey] ?? []).filter((p) => p.x !== xVal);
      return {
        ...prev,
        [chartKey]: [...arr, { x: xVal, y: yVal }].sort((a, b) => a.x - b.x),
      };
    });
  };

  const clearPoints = () =>
    setPointsByChart((prev) => ({ ...prev, [chartKey]: [] }));

  const xInputLabel =
    chartKey === "bfa"
      ? "Age (years)"
      : chartKey === "wfh"
        ? "Height (cm)"
        : "Age (months)";

  return (
    <>
      <PageHeader
        title="Growth Chart"
        back="/tools"
        variant="yellow"
        subtitle={`${meta.label} · ${meta.description}`}
      />
      <PageShell>
        {/* Chart type tabs */}
        <div
          className="brutal mb-4 grid grid-cols-3 overflow-hidden"
          data-testid="chart-tabs"
        >
          {chartOrder.map((k, i) => (
            <button
              key={k}
              data-testid={`tab-${k}`}
              onClick={() => switchChart(k)}
              className={`px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider ${
                chartKey === k ? "bg-primary" : "bg-card hover:bg-primary/30"
              } ${i % 3 !== 2 ? "border-r-2 border-border" : ""} ${
                i < 3 ? "border-b-2 border-border" : ""
              }`}
            >
              {charts[k].shortLabel}
            </button>
          ))}
        </div>

        {/* Sex selector */}
        <div className="brutal mb-4 grid grid-cols-2">
          {(["boys", "girls"] as const).map((s, i) => (
            <button
              key={s}
              data-testid={`sex-${s}`}
              onClick={() => setSex(s)}
              className={`px-3 py-3 text-sm font-bold uppercase tracking-wide ${
                sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"
              } ${i === 0 ? "border-r-2 border-border" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="brutal mb-4 space-y-3 p-4">
          <SectionTitle kicker="Plot">Add point</SectionTitle>
          <Row label={xInputLabel}>
            <NumInput
              value={xVal}
              onChange={setXVal}
              step={chartKey === "bfa" ? 1 : meta.xUnit === "cm" ? 0.5 : 1}
              min={meta.xMin}
              max={meta.xMax}
              testId="x-input"
            />
          </Row>
          <Row label={meta.yLabel}>
            <NumInput
              value={yVal}
              onChange={setYVal}
              step={meta.yStep}
              min={0}
              max={300}
              testId="y-input"
            />
          </Row>
          <button
            onClick={addPoint}
            data-testid="add-point-btn"
            className="btn-brutal w-full"
          >
            Add to chart
          </button>
          {points.length > 0 && (
            <button
              onClick={clearPoints}
              data-testid="clear-points-btn"
              className="text-[11px] font-bold uppercase tracking-wider underline"
            >
              Clear points ({points.length})
            </button>
          )}
        </div>

        <div className="brutal p-3" data-testid="chart-container">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[meta.xMin, meta.xMax]}
                  stroke="var(--foreground)"
                  fontSize={10}
                  label={{
                    value: meta.xLabel,
                    position: "insideBottom",
                    offset: -2,
                    fontSize: 10,
                  }}
                />
                <YAxis stroke="var(--foreground)" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    border: "2px solid var(--border)",
                    borderRadius: 0,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="SDneg2"
                  stroke="var(--destructive)"
                  dot={false}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  name="−2 SD"
                />
                <Line
                  type="monotone"
                  dataKey="median"
                  stroke="var(--secondary)"
                  dot={false}
                  strokeWidth={2}
                  name="Median"
                />
                <Line
                  type="monotone"
                  dataKey="SDpos2"
                  stroke="var(--chart-5)"
                  dot={false}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  name="+2 SD"
                />
                <Line
                  type="monotone"
                  dataKey="child"
                  stroke="var(--primary)"
                  strokeWidth={3}
                  dot={{
                    r: 4,
                    stroke: "var(--secondary)",
                    strokeWidth: 2,
                    fill: "var(--primary)",
                  }}
                  connectNulls
                  name="Child"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          data-testid="classification-badge"
          className={`brutal-lg mt-4 p-4 ${
            cls.tone === "success"
              ? "bg-success"
              : cls.tone === "warning"
                ? "bg-primary"
                : "bg-destructive text-destructive-foreground"
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">
            {meta.label} · current input
          </div>
          <div className="mt-1 font-display text-3xl uppercase leading-none">
            {cls.label}
          </div>
        </div>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Reference values approximate WHO standards (0–5 y) and 2007 references
          (5–19 y). For screening only.
        </p>
      </PageShell>
    </>
  );
}

function initialX(k: ChartKey): number {
  switch (k) {
    case "bfa":
      return 10;
    case "wfh":
      return 80;
    case "muac":
      return 12;
    default:
      return 12;
  }
}
function initialY(k: ChartKey): number {
  switch (k) {
    case "wfa":
      return 9;
    case "hfa":
      return 75;
    case "wfh":
      return 10;
    case "bfa":
      return 16;
    case "muac":
      return 14;
    case "hcfa":
      return 46;
  }
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
  value,
  onChange,
  step = 1,
  min,
  max,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  testId?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      data-testid={testId}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input-brutal text-right font-mono"
    />
  );
}
