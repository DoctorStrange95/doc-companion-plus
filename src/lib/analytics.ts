// Pure analytics computation — no React, no hooks, no side effects.

export interface NumericStats {
  n: number;
  mean: number;
  median: number;
  sd: number;
  se: number;
  min: number;
  max: number;
  range: number;
  ci95Lower: number;
  ci95Upper: number;
  p25: number;
  p75: number;
  histogram: { bin: string; count: number }[];
}

export interface FrequencyRow {
  label: string;
  value: string | number;
  count: number;
  percent: number;
}

export interface CategoricalStats {
  n: number;
  frequencies: FrequencyRow[];
  mode: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
  subjectId?: string;
}

export type AnalyticsChartType = "histogram" | "bar" | "pie" | "donut" | "line" | "stacked_bar" | "none";

function emptyNumeric(): NumericStats {
  return { n: 0, mean: 0, median: 0, sd: 0, se: 0, min: 0, max: 0, range: 0, ci95Lower: 0, ci95Upper: 0, p25: 0, p75: 0, histogram: [] };
}

export function computeNumericStats(raw: unknown[]): NumericStats {
  const clean = raw.map(Number).filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) return emptyNumeric();

  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];

  // Sturges' rule for bin count, capped at 15
  const binCount = Math.min(Math.max(Math.ceil(1 + 3.322 * Math.log10(n)), 2), 15);
  const lo = sorted[0];
  const hi = sorted[n - 1];
  const binWidth = hi === lo ? 1 : (hi - lo) / binCount;

  const histogram: { bin: string; count: number }[] = Array.from({ length: binCount }, (_, i) => {
    const binLo = lo + i * binWidth;
    const binHi = binLo + binWidth;
    const count = clean.filter((v) => v >= binLo && (i === binCount - 1 ? v <= binHi : v < binHi)).length;
    return { bin: `${binLo.toFixed(1)}–${binHi.toFixed(1)}`, count };
  });

  return {
    n,
    mean: +mean.toFixed(2),
    median: +median.toFixed(2),
    sd: +sd.toFixed(2),
    se: +se.toFixed(2),
    min: sorted[0],
    max: sorted[n - 1],
    range: +(sorted[n - 1] - sorted[0]).toFixed(2),
    ci95Lower: +(mean - 1.96 * se).toFixed(2),
    ci95Upper: +(mean + 1.96 * se).toFixed(2),
    p25,
    p75,
    histogram,
  };
}

export function computeCategoricalStats(
  raw: unknown[],
  options: { label: string; value: string | number }[],
): CategoricalStats {
  const nonEmpty = raw.filter((v) => v !== null && v !== undefined && v !== "");

  // For select_many, each value may be an array
  const flatValues: string[] = [];
  for (const v of nonEmpty) {
    if (Array.isArray(v)) flatValues.push(...v.map(String));
    else flatValues.push(String(v));
  }

  const n = nonEmpty.length;
  if (n === 0) return { n: 0, frequencies: [], mode: "" };

  const counts: Record<string, number> = {};
  for (const v of flatValues) counts[v] = (counts[v] ?? 0) + 1;

  const denominator = flatValues.length || 1;
  const frequencies: FrequencyRow[] = options.map((opt) => ({
    label: opt.label,
    value: opt.value,
    count: counts[String(opt.value)] ?? 0,
    percent: +((counts[String(opt.value)] ?? 0) / denominator * 100).toFixed(1),
  })).sort((a, b) => b.count - a.count);

  const mode = frequencies[0]?.label ?? "";
  return { n, frequencies, mode };
}

export function computeYesNoStats(raw: unknown[]): CategoricalStats {
  return computeCategoricalStats(raw, [
    { label: "Yes", value: "true" },
    { label: "No", value: "false" },
  ]);
}

export function computeRatingStats(raw: unknown[], max: number): { stats: NumericStats; frequencies: FrequencyRow[] } {
  const stats = computeNumericStats(raw);
  const options = Array.from({ length: max }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
  const { frequencies } = computeCategoricalStats(raw, options);
  return { stats, frequencies };
}

export function buildTimeSeries(
  raw: { value: unknown; date: number; subjectId?: string }[],
): TimeSeriesPoint[] {
  return raw
    .map((r) => ({ date: new Date(r.date).toISOString().slice(0, 10), value: Number(r.value), subjectId: r.subjectId }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function selectChartType(
  fieldType: string,
  optionCount: number,
  isLongitudinal: boolean,
): AnalyticsChartType {
  switch (fieldType) {
    case "number":
    case "slider":
    case "measurement":
    case "calculated":
      return isLongitudinal ? "line" : "histogram";
    case "rating":
      return "bar";
    case "yes_no":
    case "boolean":
      return "donut";
    case "select_one":
    case "select":
    case "radio":
      return optionCount <= 4 ? "pie" : "bar";
    case "select_many":
    case "multiselect":
      return "stacked_bar";
    default:
      return "none";
  }
}
