/**
 * WHO Child Growth Standards 2006 — LMS-based computation
 *
 * Data source: WHO expanded tables (daily), extracted at monthly intervals.
 * HAZ (height/length-for-age): directly from WHO Excel (proper LMS).
 * WAZ (weight-for-age): L from published WHO tables, M/S back-calculated from SD bands.
 * WHZ (weight-for-height): approximate LMS from SD band data.
 *
 * Key: M column is the actual median measurement in cm (HAZ) or kg (WAZ/WHZ).
 * getLMSValue(L,M,S, k) returns the ABSOLUTE measurement at k standard deviations.
 */

import girlsRaw from "../data/who-lms-girls.json";
import boysRaw from "../data/who-lms-boys.json";

export interface LMSRow {
  age?: number;    // months  (HAZ, WAZ)
  height?: number; // cm      (WHZ)
  L: number;
  M: number;       // median in actual units (cm or kg)
  S: number;
}

export interface WHODataSet {
  haz: LMSRow[];
  waz: LMSRow[];
  whz: LMSRow[];
}

const girlsData = girlsRaw as WHODataSet;
const boysData  = boysRaw  as WHODataSet;

export function getWHOData(sex: string): WHODataSet {
  const isMale = sex.toLowerCase().startsWith("m");
  return isMale ? boysData : girlsData;
}

// ── LMS formula ───────────────────────────────────────────────────────────────

/**
 * Returns the ABSOLUTE measurement value at `k` standard deviations.
 * For a girl at 24m with M=85.7, S=0.0376:
 *   getLMSValue(1, 85.7, 0.0376, -3) ≈ 76.0 cm
 *   getLMSValue(1, 85.7, 0.0376,  0) = 85.7 cm
 *   getLMSValue(1, 85.7, 0.0376, +3) ≈ 95.4 cm
 */
export function getLMSValue(L: number, M: number, S: number, k: number): number {
  if (Math.abs(L) < 0.001) return M * Math.exp(k * S);
  const raw = M * Math.pow(1 + L * S * k, 1 / L);
  return Math.round(raw * 10) / 10;
}

/**
 * Compute a Z-score from an actual measurement X.
 * Returns a dimensionless value (e.g. −2.4 = moderately stunted).
 * Caps at ±3 SD using WHO's extended SD formula.
 */
export function computeZScore(X: number, L: number, M: number, S: number): number {
  if (X <= 0 || M <= 0) return 0;
  let z: number;
  if (Math.abs(L) < 0.001) {
    z = Math.log(X / M) / S;
  } else {
    z = (Math.pow(X / M, L) - 1) / (L * S);
  }
  // WHO SD3 extension for extreme values
  if (z > 3) {
    const sd3p = getLMSValue(L, M, S, 3);
    const sd2p = getLMSValue(L, M, S, 2);
    if (sd3p > sd2p) return 3 + (X - sd3p) / (sd3p - sd2p);
  }
  if (z < -3) {
    const sd3n = getLMSValue(L, M, S, -3);
    const sd2n = getLMSValue(L, M, S, -2);
    if (sd2n > sd3n) return -3 + (X - sd3n) / (sd2n - sd3n);
  }
  return Math.round(z * 100) / 100;
}

// ── Table lookup with linear interpolation ────────────────────────────────────

function findByAge(table: LMSRow[], ageMonths: number): LMSRow | null {
  if (!table.length) return null;
  const sorted = [...table].sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
  if (ageMonths <= sorted[0].age!) return sorted[0];
  if (ageMonths >= sorted[sorted.length - 1].age!) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (ageMonths >= lo.age! && ageMonths <= hi.age!) {
      const t = (ageMonths - lo.age!) / (hi.age! - lo.age!);
      return {
        age: ageMonths,
        L: lo.L + t * (hi.L - lo.L),
        M: lo.M + t * (hi.M - lo.M),
        S: lo.S + t * (hi.S - lo.S),
      };
    }
  }
  return sorted[sorted.length - 1];
}

function findByHeight(table: LMSRow[], heightCm: number): LMSRow | null {
  if (!table.length) return null;
  const sorted = [...table].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  if (heightCm <= sorted[0].height!) return sorted[0];
  if (heightCm >= sorted[sorted.length - 1].height!) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (heightCm >= lo.height! && heightCm <= hi.height!) {
      const t = (heightCm - lo.height!) / (hi.height! - lo.height!);
      return {
        height: heightCm,
        L: lo.L + t * (hi.L - lo.L),
        M: lo.M + t * (hi.M - lo.M),
        S: lo.S + t * (hi.S - lo.S),
      };
    }
  }
  return sorted[sorted.length - 1];
}

// ── Chart reference band builder ──────────────────────────────────────────────

export interface ChartRefPoint {
  age: number;
  sd3n: number;  // absolute cm or kg at −3 SD
  sd2n: number;  // absolute cm or kg at −2 SD
  med:  number;  // median (= M)
  sd2p: number;  // absolute cm or kg at +2 SD
  sd3p: number;  // absolute cm or kg at +3 SD
  L: number; M: number; S: number;
}

function buildRef(table: LMSRow[], ageStart: number, ageEnd: number): ChartRefPoint[] {
  const pts: ChartRefPoint[] = [];
  for (let mo = Math.max(0, Math.floor(ageStart)); mo <= Math.min(60, Math.ceil(ageEnd)); mo++) {
    const row = findByAge(table, mo);
    if (!row) continue;
    pts.push({
      age:  mo,
      sd3n: getLMSValue(row.L, row.M, row.S, -3),
      sd2n: getLMSValue(row.L, row.M, row.S, -2),
      med:  row.M,
      sd2p: getLMSValue(row.L, row.M, row.S,  2),
      sd3p: getLMSValue(row.L, row.M, row.S,  3),
      L: row.L, M: row.M, S: row.S,
    });
  }
  return pts;
}

export function buildHAZRef(sex: string, ageStart: number, ageEnd: number): ChartRefPoint[] {
  return buildRef(getWHOData(sex).haz, ageStart, ageEnd);
}

export function buildWAZRef(sex: string, ageStart: number, ageEnd: number): ChartRefPoint[] {
  return buildRef(getWHOData(sex).waz, ageStart, ageEnd);
}

// ── Z-score computation for a single visit ────────────────────────────────────

export interface VisitZScores {
  haz: number | null;
  waz: number | null;
  whz: number | null;
  hazLabel: string;
  wazLabel: string;
  isSAM: boolean;
  isMAM: boolean;
  samCriteria: string;
}

function hazLabel(z: number | null): string {
  if (z === null) return "—";
  if (z < -3) return "Severely Stunted";
  if (z < -2) return "Stunted";
  if (z > 2)  return "Tall";
  return "Normal";
}
function wazLabel(z: number | null): string {
  if (z === null) return "—";
  if (z < -3) return "Severely Underweight";
  if (z < -2) return "Underweight";
  if (z > 2)  return "Overweight";
  return "Normal";
}

/**
 * Compute Z-scores and SAM/MAM classification for a visit.
 * heightCm should already have position correction applied if needed.
 */
export function computeVisitZScores(
  sex: string,
  ageMonths: number,
  weightKg: number,
  heightCm: number,
  muacCm?: number,
  edema?: boolean,
): VisitZScores {
  const data = getWHOData(sex);
  const hazRow = findByAge(data.haz, ageMonths);
  const wazRow = findByAge(data.waz, ageMonths);
  const whzRow = findByHeight(data.whz, heightCm);

  const haz = hazRow && heightCm > 0 ? computeZScore(heightCm, hazRow.L, hazRow.M, hazRow.S) : null;
  const waz = wazRow && weightKg > 0 ? computeZScore(weightKg, wazRow.L, wazRow.M, wazRow.S) : null;
  const whz = whzRow && weightKg > 0 ? computeZScore(weightKg, whzRow.L, whzRow.M, whzRow.S) : null;

  const samCriteria: string[] = [];
  if (edema)                                    samCriteria.push("Bilateral oedema");
  if (whz !== null && whz < -3)                 samCriteria.push(`WHZ ${whz.toFixed(2)}`);
  if (muacCm !== undefined && muacCm < 11.5)    samCriteria.push(`MUAC ${muacCm} cm`);
  const isSAM = samCriteria.length > 0;

  const mamCriteria: string[] = [];
  if (!isSAM) {
    if (whz !== null && whz >= -3 && whz < -2)                        mamCriteria.push(`WHZ ${whz.toFixed(2)}`);
    if (muacCm !== undefined && muacCm >= 11.5 && muacCm < 12.5)      mamCriteria.push(`MUAC ${muacCm} cm`);
  }
  const isMAM = mamCriteria.length > 0;

  return {
    haz, waz, whz,
    hazLabel: hazLabel(haz),
    wazLabel: wazLabel(waz),
    isSAM, isMAM,
    samCriteria: samCriteria.join(", "),
  };
}

/**
 * WHO position correction:
 *   child < 24m measured standing  → +0.7 cm (convert to length equivalent)
 *   child ≥ 24m measured lying     → −0.7 cm (convert to height equivalent)
 */
export function applyPositionCorrection(
  heightCm: number,
  ageMonths: number,
  isLying: boolean,
): number {
  const shouldBeLying = ageMonths < 24;
  if (isLying && !shouldBeLying) return Math.round((heightCm - 0.7) * 10) / 10;
  if (!isLying && shouldBeLying) return Math.round((heightCm + 0.7) * 10) / 10;
  return heightCm;
}

/** Z-score colour tier: red (SAM) / amber (MAM/at-risk) / green (normal) */
export function zColor(z: number | null): string {
  if (z === null) return "var(--muted-foreground)";
  if (z < -3 || z > 3) return "#dc2626";  // red
  if (z < -2 || z > 2) return "#f59e0b";  // amber
  return "#16a34a";                         // green
}
