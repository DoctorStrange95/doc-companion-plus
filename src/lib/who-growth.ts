// Approximate WHO growth references (MVP). Values are derived from public WHO
// child growth standards (0-5y) and 2007 references (5-19y), rounded for use as
// on-screen reference bands. They are NOT a substitute for the full LMS-based
// z-score calculation. Use only for visualisation / quick screening.

export type Sex = "boys" | "girls";

export interface RefRow {
  x: number; // age in months OR height in cm depending on chart
  SDneg2: number;
  median: number;
  SDpos2: number;
}

export interface ChartMeta {
  key: ChartKey;
  label: string;
  shortLabel: string;
  xLabel: string; // e.g. Months, Years, cm
  yLabel: string; // e.g. Weight (kg)
  yUnit: string;
  xUnit: string;
  xMin: number;
  xMax: number;
  yStep: number;
  description: string;
}

export type ChartKey =
  | "wfa"
  | "hfa"
  | "wfh"
  | "bfa"
  | "muac"
  | "hcfa";

export const charts: Record<ChartKey, ChartMeta> = {
  wfa: {
    key: "wfa",
    label: "Weight-for-age",
    shortLabel: "Weight",
    xLabel: "Months",
    yLabel: "Weight (kg)",
    yUnit: "kg",
    xUnit: "mo",
    xMin: 0,
    xMax: 60,
    yStep: 0.1,
    description: "WHO 0–60 months",
  },
  hfa: {
    key: "hfa",
    label: "Height/Length-for-age",
    shortLabel: "Height",
    xLabel: "Months",
    yLabel: "Length/Height (cm)",
    yUnit: "cm",
    xUnit: "mo",
    xMin: 0,
    xMax: 60,
    yStep: 0.1,
    description: "WHO 0–60 months",
  },
  wfh: {
    key: "wfh",
    label: "Weight-for-height",
    shortLabel: "W-for-H",
    xLabel: "Height (cm)",
    yLabel: "Weight (kg)",
    yUnit: "kg",
    xUnit: "cm",
    xMin: 45,
    xMax: 120,
    yStep: 0.1,
    description: "WHO 45–120 cm",
  },
  bfa: {
    key: "bfa",
    label: "BMI-for-age",
    shortLabel: "BMI",
    xLabel: "Years",
    yLabel: "BMI (kg/m²)",
    yUnit: "kg/m²",
    xUnit: "y",
    xMin: 5,
    xMax: 19,
    yStep: 0.1,
    description: "WHO 5–19 years",
  },
  muac: {
    key: "muac",
    label: "MUAC-for-age",
    shortLabel: "MUAC",
    xLabel: "Months",
    yLabel: "MUAC (cm)",
    yUnit: "cm",
    xUnit: "mo",
    xMin: 3,
    xMax: 60,
    yStep: 0.1,
    description: "WHO 3–60 months",
  },
  hcfa: {
    key: "hcfa",
    label: "Head circumference-for-age",
    shortLabel: "Head circ.",
    xLabel: "Months",
    yLabel: "Head circ. (cm)",
    yUnit: "cm",
    xUnit: "mo",
    xMin: 0,
    xMax: 60,
    yStep: 0.1,
    description: "WHO 0–60 months",
  },
};

// Weight-for-age (kg) — boys
const wfaBoys: RefRow[] = [
  { x: 0, SDneg2: 2.5, median: 3.3, SDpos2: 4.4 },
  { x: 6, SDneg2: 6.4, median: 7.9, SDpos2: 9.7 },
  { x: 12, SDneg2: 7.7, median: 9.6, SDpos2: 12.0 },
  { x: 18, SDneg2: 8.8, median: 10.9, SDpos2: 13.7 },
  { x: 24, SDneg2: 9.7, median: 12.2, SDpos2: 15.3 },
  { x: 30, SDneg2: 10.5, median: 13.3, SDpos2: 16.9 },
  { x: 36, SDneg2: 11.3, median: 14.3, SDpos2: 18.3 },
  { x: 42, SDneg2: 12.0, median: 15.3, SDpos2: 19.7 },
  { x: 48, SDneg2: 12.7, median: 16.3, SDpos2: 21.2 },
  { x: 54, SDneg2: 13.4, median: 17.3, SDpos2: 22.7 },
  { x: 60, SDneg2: 14.1, median: 18.3, SDpos2: 24.2 },
];
const wfaGirls: RefRow[] = [
  { x: 0, SDneg2: 2.4, median: 3.2, SDpos2: 4.2 },
  { x: 6, SDneg2: 5.7, median: 7.3, SDpos2: 9.2 },
  { x: 12, SDneg2: 7.0, median: 8.9, SDpos2: 11.5 },
  { x: 18, SDneg2: 8.1, median: 10.2, SDpos2: 13.2 },
  { x: 24, SDneg2: 9.0, median: 11.5, SDpos2: 14.8 },
  { x: 30, SDneg2: 9.8, median: 12.7, SDpos2: 16.4 },
  { x: 36, SDneg2: 10.6, median: 13.9, SDpos2: 18.0 },
  { x: 42, SDneg2: 11.3, median: 14.9, SDpos2: 19.5 },
  { x: 48, SDneg2: 12.0, median: 15.9, SDpos2: 21.0 },
  { x: 54, SDneg2: 12.7, median: 17.0, SDpos2: 22.5 },
  { x: 60, SDneg2: 13.4, median: 18.0, SDpos2: 24.0 },
];

// Height/Length-for-age (cm) — 0–60 mo
const hfaBoys: RefRow[] = [
  { x: 0, SDneg2: 46.1, median: 49.9, SDpos2: 53.7 },
  { x: 6, SDneg2: 63.3, median: 67.6, SDpos2: 71.9 },
  { x: 12, SDneg2: 71.0, median: 75.7, SDpos2: 80.5 },
  { x: 18, SDneg2: 76.9, median: 82.3, SDpos2: 87.7 },
  { x: 24, SDneg2: 81.7, median: 87.8, SDpos2: 93.9 },
  { x: 30, SDneg2: 85.5, median: 91.9, SDpos2: 98.3 },
  { x: 36, SDneg2: 88.7, median: 95.7, SDpos2: 102.7 },
  { x: 42, SDneg2: 91.9, median: 99.0, SDpos2: 106.2 },
  { x: 48, SDneg2: 94.9, median: 102.3, SDpos2: 109.8 },
  { x: 54, SDneg2: 97.4, median: 105.3, SDpos2: 113.2 },
  { x: 60, SDneg2: 99.9, median: 110.0, SDpos2: 120.0 },
];
const hfaGirls: RefRow[] = [
  { x: 0, SDneg2: 45.4, median: 49.1, SDpos2: 52.9 },
  { x: 6, SDneg2: 61.2, median: 65.7, SDpos2: 70.3 },
  { x: 12, SDneg2: 68.9, median: 74.0, SDpos2: 79.2 },
  { x: 18, SDneg2: 74.9, median: 80.7, SDpos2: 86.5 },
  { x: 24, SDneg2: 80.0, median: 86.4, SDpos2: 92.9 },
  { x: 30, SDneg2: 83.6, median: 90.7, SDpos2: 97.7 },
  { x: 36, SDneg2: 87.4, median: 95.1, SDpos2: 102.7 },
  { x: 42, SDneg2: 90.9, median: 98.9, SDpos2: 106.9 },
  { x: 48, SDneg2: 94.1, median: 102.7, SDpos2: 111.3 },
  { x: 54, SDneg2: 97.1, median: 106.2, SDpos2: 115.2 },
  { x: 60, SDneg2: 99.9, median: 109.4, SDpos2: 118.9 },
];

// Weight-for-height (kg by cm)
const wfhBoys: RefRow[] = [
  { x: 45, SDneg2: 1.9, median: 2.4, SDpos2: 3.0 },
  { x: 50, SDneg2: 2.6, median: 3.3, SDpos2: 4.0 },
  { x: 55, SDneg2: 3.6, median: 4.5, SDpos2: 5.5 },
  { x: 60, SDneg2: 4.4, median: 5.5, SDpos2: 6.7 },
  { x: 65, SDneg2: 5.5, median: 6.7, SDpos2: 8.0 },
  { x: 70, SDneg2: 6.4, median: 7.7, SDpos2: 9.2 },
  { x: 75, SDneg2: 7.3, median: 8.7, SDpos2: 10.3 },
  { x: 80, SDneg2: 8.3, median: 9.8, SDpos2: 11.6 },
  { x: 85, SDneg2: 9.2, median: 10.9, SDpos2: 12.9 },
  { x: 90, SDneg2: 10.1, median: 12.0, SDpos2: 14.2 },
  { x: 95, SDneg2: 11.1, median: 13.3, SDpos2: 15.7 },
  { x: 100, SDneg2: 12.2, median: 14.6, SDpos2: 17.4 },
  { x: 110, SDneg2: 14.6, median: 17.5, SDpos2: 21.0 },
  { x: 120, SDneg2: 17.0, median: 20.7, SDpos2: 25.6 },
];
const wfhGirls: RefRow[] = [
  { x: 45, SDneg2: 1.9, median: 2.5, SDpos2: 3.0 },
  { x: 50, SDneg2: 2.6, median: 3.2, SDpos2: 4.0 },
  { x: 55, SDneg2: 3.4, median: 4.2, SDpos2: 5.2 },
  { x: 60, SDneg2: 4.2, median: 5.1, SDpos2: 6.4 },
  { x: 65, SDneg2: 5.1, median: 6.1, SDpos2: 7.7 },
  { x: 70, SDneg2: 6.0, median: 7.2, SDpos2: 9.0 },
  { x: 75, SDneg2: 6.9, median: 8.2, SDpos2: 10.2 },
  { x: 80, SDneg2: 7.8, median: 9.3, SDpos2: 11.6 },
  { x: 85, SDneg2: 8.7, median: 10.4, SDpos2: 13.0 },
  { x: 90, SDneg2: 9.7, median: 11.6, SDpos2: 14.5 },
  { x: 95, SDneg2: 10.7, median: 12.9, SDpos2: 16.1 },
  { x: 100, SDneg2: 11.8, median: 14.2, SDpos2: 17.9 },
  { x: 110, SDneg2: 14.2, median: 17.1, SDpos2: 21.7 },
  { x: 120, SDneg2: 16.6, median: 20.3, SDpos2: 26.2 },
];

// BMI-for-age (kg/m²) — yearly 5–19
const bfaBoys: RefRow[] = [
  { x: 5, SDneg2: 13.0, median: 15.3, SDpos2: 17.0 },
  { x: 6, SDneg2: 13.0, median: 15.3, SDpos2: 17.5 },
  { x: 7, SDneg2: 13.1, median: 15.5, SDpos2: 17.9 },
  { x: 8, SDneg2: 13.3, median: 15.7, SDpos2: 18.4 },
  { x: 9, SDneg2: 13.5, median: 16.0, SDpos2: 19.1 },
  { x: 10, SDneg2: 13.7, median: 16.4, SDpos2: 19.8 },
  { x: 11, SDneg2: 14.1, median: 16.9, SDpos2: 20.7 },
  { x: 12, SDneg2: 14.5, median: 17.5, SDpos2: 21.5 },
  { x: 13, SDneg2: 14.9, median: 18.2, SDpos2: 22.4 },
  { x: 14, SDneg2: 15.5, median: 19.0, SDpos2: 23.3 },
  { x: 15, SDneg2: 16.0, median: 19.8, SDpos2: 24.2 },
  { x: 16, SDneg2: 16.5, median: 20.5, SDpos2: 25.0 },
  { x: 17, SDneg2: 16.9, median: 21.1, SDpos2: 25.7 },
  { x: 18, SDneg2: 17.3, median: 21.7, SDpos2: 26.4 },
  { x: 19, SDneg2: 17.6, median: 22.2, SDpos2: 27.0 },
];
const bfaGirls: RefRow[] = [
  { x: 5, SDneg2: 12.7, median: 15.2, SDpos2: 17.0 },
  { x: 6, SDneg2: 12.7, median: 15.3, SDpos2: 17.5 },
  { x: 7, SDneg2: 12.8, median: 15.4, SDpos2: 18.0 },
  { x: 8, SDneg2: 13.0, median: 15.7, SDpos2: 18.7 },
  { x: 9, SDneg2: 13.2, median: 16.1, SDpos2: 19.4 },
  { x: 10, SDneg2: 13.5, median: 16.6, SDpos2: 20.3 },
  { x: 11, SDneg2: 13.9, median: 17.2, SDpos2: 21.3 },
  { x: 12, SDneg2: 14.4, median: 18.0, SDpos2: 22.2 },
  { x: 13, SDneg2: 14.9, median: 18.8, SDpos2: 23.2 },
  { x: 14, SDneg2: 15.4, median: 19.6, SDpos2: 24.0 },
  { x: 15, SDneg2: 15.7, median: 20.2, SDpos2: 24.8 },
  { x: 16, SDneg2: 16.0, median: 20.7, SDpos2: 25.4 },
  { x: 17, SDneg2: 16.2, median: 21.0, SDpos2: 25.9 },
  { x: 18, SDneg2: 16.4, median: 21.3, SDpos2: 26.4 },
  { x: 19, SDneg2: 16.5, median: 21.5, SDpos2: 26.8 },
];

// MUAC-for-age (cm) — 3–60 mo
const muacBoys: RefRow[] = [
  { x: 3, SDneg2: 11.7, median: 13.4, SDpos2: 15.1 },
  { x: 6, SDneg2: 12.5, median: 14.3, SDpos2: 16.1 },
  { x: 12, SDneg2: 13.0, median: 14.9, SDpos2: 16.8 },
  { x: 18, SDneg2: 13.4, median: 15.3, SDpos2: 17.2 },
  { x: 24, SDneg2: 13.6, median: 15.5, SDpos2: 17.4 },
  { x: 36, SDneg2: 13.8, median: 15.8, SDpos2: 17.8 },
  { x: 48, SDneg2: 14.1, median: 16.1, SDpos2: 18.2 },
  { x: 60, SDneg2: 14.4, median: 16.5, SDpos2: 18.7 },
];
const muacGirls: RefRow[] = [
  { x: 3, SDneg2: 11.4, median: 13.1, SDpos2: 14.8 },
  { x: 6, SDneg2: 12.1, median: 13.9, SDpos2: 15.7 },
  { x: 12, SDneg2: 12.7, median: 14.6, SDpos2: 16.5 },
  { x: 18, SDneg2: 13.0, median: 14.9, SDpos2: 16.9 },
  { x: 24, SDneg2: 13.2, median: 15.2, SDpos2: 17.2 },
  { x: 36, SDneg2: 13.5, median: 15.5, SDpos2: 17.7 },
  { x: 48, SDneg2: 13.8, median: 15.9, SDpos2: 18.2 },
  { x: 60, SDneg2: 14.1, median: 16.3, SDpos2: 18.7 },
];

// Head circumference-for-age (cm) — 0–60 mo
const hcfaBoys: RefRow[] = [
  { x: 0, SDneg2: 32.6, median: 34.5, SDpos2: 36.4 },
  { x: 6, SDneg2: 41.5, median: 43.3, SDpos2: 45.2 },
  { x: 12, SDneg2: 44.2, median: 46.1, SDpos2: 48.0 },
  { x: 18, SDneg2: 45.6, median: 47.4, SDpos2: 49.3 },
  { x: 24, SDneg2: 46.6, median: 48.3, SDpos2: 50.2 },
  { x: 36, SDneg2: 47.7, median: 49.5, SDpos2: 51.4 },
  { x: 48, SDneg2: 48.5, median: 50.4, SDpos2: 52.2 },
  { x: 60, SDneg2: 49.0, median: 50.9, SDpos2: 52.8 },
];
const hcfaGirls: RefRow[] = [
  { x: 0, SDneg2: 32.0, median: 33.9, SDpos2: 35.8 },
  { x: 6, SDneg2: 40.2, median: 42.2, SDpos2: 44.2 },
  { x: 12, SDneg2: 43.0, median: 45.0, SDpos2: 46.9 },
  { x: 18, SDneg2: 44.5, median: 46.4, SDpos2: 48.3 },
  { x: 24, SDneg2: 45.5, median: 47.4, SDpos2: 49.3 },
  { x: 36, SDneg2: 46.6, median: 48.5, SDpos2: 50.4 },
  { x: 48, SDneg2: 47.4, median: 49.3, SDpos2: 51.2 },
  { x: 60, SDneg2: 47.9, median: 49.8, SDpos2: 51.7 },
];

export const refTables: Record<ChartKey, Record<Sex, RefRow[]>> = {
  wfa: { boys: wfaBoys, girls: wfaGirls },
  hfa: { boys: hfaBoys, girls: hfaGirls },
  wfh: { boys: wfhBoys, girls: wfhGirls },
  bfa: { boys: bfaBoys, girls: bfaGirls },
  muac: { boys: muacBoys, girls: muacGirls },
  hcfa: { boys: hcfaBoys, girls: hcfaGirls },
};

export function interpolated(ref: RefRow[], x: number): RefRow {
  if (x <= ref[0].x) return ref[0];
  if (x >= ref[ref.length - 1].x) return ref[ref.length - 1];
  for (let i = 0; i < ref.length - 1; i++) {
    if (x >= ref[i].x && x <= ref[i + 1].x) {
      const t = (x - ref[i].x) / (ref[i + 1].x - ref[i].x);
      const lerp = (a: number, b: number) => a + (b - a) * t;
      return {
        x,
        SDneg2: lerp(ref[i].SDneg2, ref[i + 1].SDneg2),
        median: lerp(ref[i].median, ref[i + 1].median),
        SDpos2: lerp(ref[i].SDpos2, ref[i + 1].SDpos2),
      };
    }
  }
  return ref[0];
}

export function classify(
  chart: ChartKey,
  ref: RefRow,
  v: number,
): { label: string; tone: "success" | "warning" | "destructive" } {
  const lowMid = ref.SDneg2 - (ref.median - ref.SDneg2) / 2; // ~ -3SD approx
  if (chart === "muac") {
    if (v < 11.5) return { label: "Severe Acute Malnutrition", tone: "destructive" };
    if (v < 12.5) return { label: "Moderate Acute Malnutrition", tone: "warning" };
    return { label: "Normal", tone: "success" };
  }
  if (chart === "wfh" || chart === "wfa" || chart === "bfa") {
    if (v < lowMid) return { label: "Severe (< -3 SD)", tone: "destructive" };
    if (v < ref.SDneg2) return { label: "Moderate (-2 to -3 SD)", tone: "warning" };
    if (v > ref.SDpos2) return { label: "Above +2 SD", tone: "warning" };
    return { label: "Normal", tone: "success" };
  }
  if (chart === "hfa") {
    if (v < lowMid) return { label: "Severe Stunting", tone: "destructive" };
    if (v < ref.SDneg2) return { label: "Stunted", tone: "warning" };
    if (v > ref.SDpos2) return { label: "Tall (> +2 SD)", tone: "warning" };
    return { label: "Normal", tone: "success" };
  }
  if (chart === "hcfa") {
    if (v < ref.SDneg2) return { label: "Microcephaly risk", tone: "destructive" };
    if (v > ref.SDpos2) return { label: "Macrocephaly risk", tone: "warning" };
    return { label: "Normal", tone: "success" };
  }
  return { label: "—", tone: "success" };
}
