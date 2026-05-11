/**
 * Converts WHO Child Growth Standards Excel files to a TypeScript LMS data file.
 * Run: node scripts/convert-who-data.mjs
 *
 * Expected input files in src/data/who/:
 *   lhfa-girls-expanded.xlsx  (height/length-for-age, girls 0-60m)
 *   lhfa-boys-expanded.xlsx   (height/length-for-age, boys 0-60m)
 *
 * For WAZ/WHZ we derive LMS from the pre-computed SD band values in who-data.ts.
 */

import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function parseHAZTable(filePath) {
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  // The WHO expanded table is indexed by Day (0–1856) and contains BOTH the
  // 0–24m supine-length table (Days 0–730) and the 24–60m standing-height table
  // (Days 731–1856) concatenated. There is a visible jump of ~0.7 cm at day 730→731
  // corresponding to the position correction.
  //
  // Strategy:
  //   months 0–23  → pick the row with Day closest to month*30.4375, constrained ≤ 730
  //   month 24–60 → pick the row with Day closest to month*30.4375, constrained ≥ 731
  const allRows = XLSX.utils.sheet_to_json(ws)
  const byDay = new Map(allRows.map(r => [Number(r['Day']), r]))

  const out = []
  for (let month = 0; month <= 60; month++) {
    const targetDay = month * 30.4375
    const isStanding = month >= 24
    const candidates = allRows.filter(r => {
      const d = Number(r['Day'])
      return isStanding ? d >= 731 : d <= 730
    })
    let best = null, bestDist = Infinity
    for (const row of candidates) {
      const day = Number(row['Day'])
      const dist = Math.abs(day - targetDay)
      if (dist < bestDist) { bestDist = dist; best = row }
    }
    if (!best) continue
    const L = Number(best['L'])
    const M = Number(best['M'])
    const S = Number(best['S'])
    if (!isFinite(L) || !isFinite(M) || !isFinite(S)) continue
    out.push({ age: month, L: round4(L), M: round4(M), S: round4(S) })
  }
  return out
}

function round4(n) { return Math.round(n * 10000) / 10000 }

// ── WAZ: derive LMS from pre-computed SD bands ────────────────────────────
// WHO uses a Box-Cox power around L≈0.3 for weight. We solve for L,M,S from
// the three SD band values: SD3neg, SD2neg, median, SD2pos, SD3pos.
// For L≈1: M=median, S=(median-SD2neg)/(2*median). Better: solve numerically.
// We use a simpler approximation: assume L is known (published WHO value) and
// back-calculate M and S from median and SD2neg.

// Published L values for WAZ (approximate, from WHO 2006 tables):
const WAZ_L_BOYS = {
  0:0.3487,1:0.2297,2:0.1970,3:0.1729,4:0.1738,5:0.1715,6:0.1730,
  7:0.1778,8:0.1848,9:0.1937,10:0.2041,11:0.2158,12:0.2279,13:0.2400,
  14:0.2513,15:0.2614,18:0.2927,21:0.3202,24:0.3452,27:0.3667,
  30:0.3845,33:0.3985,36:0.4086,39:0.4154,42:0.4193,45:0.4207,
  48:0.4202,51:0.4181,54:0.4150,57:0.4114,60:0.4075
}
const WAZ_L_GIRLS = {
  0:0.3809,1:0.1714,2:0.1714,3:0.2177,4:0.2237,5:0.2367,6:0.2524,
  7:0.2704,8:0.2895,9:0.3091,10:0.3284,11:0.3467,12:0.3634,13:0.3782,
  14:0.3907,15:0.4005,18:0.4233,21:0.4357,24:0.4411,27:0.4409,
  30:0.4356,33:0.4261,36:0.4137,39:0.3994,42:0.3839,45:0.3678,
  48:0.3513,51:0.3348,54:0.3183,57:0.3020,60:0.2860
}

// Pre-computed SD bands from who-data.ts (WFA_BOYS and WFA_GIRLS)
// Format: [age, SD3neg, SD2neg, median, SD2pos, SD3pos]
const WFA_BOYS_BANDS = [
  [0,2.1,2.5,3.3,4.4,5.0],[1,2.9,3.4,4.5,5.8,6.6],[2,3.8,4.3,5.6,7.1,8.0],
  [3,4.4,5.0,6.4,8.0,9.0],[4,4.9,5.6,7.0,8.7,9.7],[5,5.3,6.0,7.5,9.3,10.4],
  [6,5.7,6.4,7.9,9.8,10.9],[7,5.9,6.7,8.3,10.2,11.4],[8,6.2,7.0,8.6,10.5,11.7],
  [9,6.4,7.2,8.9,10.9,12.1],[10,6.6,7.5,9.2,11.2,12.5],[11,6.8,7.7,9.4,11.5,12.8],
  [12,6.9,7.8,9.6,11.8,13.1],[15,7.4,8.4,10.3,12.6,14.1],[18,7.8,8.9,10.9,13.4,15.0],
  [21,8.2,9.3,11.5,14.1,15.8],[24,8.6,9.7,12.0,14.8,16.6],[27,8.9,10.2,12.5,15.4,17.3],
  [30,9.3,10.5,13.0,16.1,18.0],[33,9.6,10.9,13.5,16.7,18.8],[36,9.8,11.2,14.0,17.3,19.5],
  [39,10.1,11.5,14.4,17.9,20.2],[42,10.4,11.8,14.9,18.5,20.9],[45,10.6,12.1,15.3,19.1,21.6],
  [48,10.9,12.4,15.7,19.6,22.3],[51,11.1,12.7,16.2,20.2,23.0],[54,11.3,13.0,16.6,20.8,23.7],
  [57,11.6,13.3,17.1,21.5,24.5],[60,11.8,13.6,17.5,22.1,25.2],
]
const WFA_GIRLS_BANDS = [
  [0,2.0,2.4,3.2,4.2,4.8],[1,2.7,3.2,4.2,5.5,6.2],[2,3.4,3.9,5.1,6.6,7.5],
  [3,4.0,4.5,5.8,7.5,8.5],[4,4.4,5.0,6.4,8.2,9.3],[5,4.8,5.4,6.9,8.8,10.0],
  [6,5.1,5.7,7.3,9.3,10.6],[7,5.3,6.0,7.6,9.8,11.1],[8,5.6,6.3,7.9,10.2,11.6],
  [9,5.8,6.5,8.2,10.5,12.0],[10,6.0,6.7,8.5,10.9,12.4],[11,6.1,6.9,8.7,11.2,12.8],
  [12,6.3,7.1,8.9,11.5,13.1],[15,6.8,7.6,9.6,12.4,14.2],[18,7.2,8.1,10.2,13.2,15.1],
  [21,7.6,8.6,10.9,14.0,16.0],[24,7.9,9.0,11.5,14.8,17.0],[27,8.3,9.4,12.0,15.6,17.9],
  [30,8.6,9.8,12.5,16.3,18.8],[33,8.9,10.2,13.0,17.0,19.7],[36,9.2,10.5,13.5,17.7,20.6],
  [39,9.5,10.9,14.0,18.4,21.5],[42,9.8,11.2,14.5,19.2,22.4],[45,10.1,11.5,15.0,19.9,23.4],
  [48,10.4,11.8,15.4,20.6,24.3],[51,10.6,12.2,15.9,21.4,25.2],[54,10.9,12.5,16.4,22.1,26.2],
  [57,11.2,12.9,16.9,22.9,27.2],[60,11.5,13.2,17.3,23.7,28.2],
]

// WHZ pre-computed SD bands (Weight-for-height, keyed by height cm)
const WFH_BOYS_BANDS = [
  [45,1.9,2.4,3.0],[50,2.6,3.3,4.0],[55,3.6,4.5,5.5],[60,4.4,5.5,6.7],
  [65,5.5,6.7,8.0],[70,6.4,7.7,9.2],[75,7.3,8.7,10.3],[80,8.3,9.8,11.6],
  [85,9.2,10.9,12.9],[90,10.1,12.0,14.2],[95,11.1,13.3,15.7],
  [100,12.2,14.6,17.4],[110,14.6,17.5,21.0],[120,17.0,20.7,25.6],
]
const WFH_GIRLS_BANDS = [
  [45,1.9,2.5,3.0],[50,2.6,3.2,4.0],[55,3.4,4.2,5.2],[60,4.2,5.1,6.4],
  [65,5.1,6.1,7.7],[70,6.0,7.2,9.0],[75,6.9,8.2,10.2],[80,7.8,9.3,11.6],
  [85,8.7,10.4,13.0],[90,9.7,11.6,14.5],[95,10.7,12.9,16.1],
  [100,11.8,14.2,17.9],[110,14.2,17.1,21.7],[120,16.6,20.3,26.2],
]

/**
 * Given SD bands [age, SD3neg, SD2neg, median, SD2pos, SD3pos] and
 * a known L exponent, back-calculate M and S using the LMS formula.
 * For SD2neg = M*(1+L*S*(-2))^(1/L), given L and median=M, solve for S.
 */
function backCalcLMS(sd2neg, median, L) {
  const M = median
  // sd2neg = M * (1 + L*S*(-2))^(1/L) → (sd2neg/M)^L = 1 - 2*L*S → S = (1-(sd2neg/M)^L)/(2*L)
  if (Math.abs(L) < 0.001) {
    // log-normal: sd2neg = M*exp(-2*S)
    const S = -Math.log(sd2neg / M) / 2
    return { L, M: round4(M), S: round4(S) }
  }
  const S = (1 - Math.pow(sd2neg / M, L)) / (2 * L)
  return { L: round4(L), M: round4(M), S: round4(S) }
}

function deriveLMS(bands, lTable) {
  return bands.map(([age, , sd2neg, median]) => {
    // Find nearest L value in table
    const ages = Object.keys(lTable).map(Number).sort((a, b) => a - b)
    let bestAge = ages[0]
    for (const a of ages) {
      if (a <= age) bestAge = a
    }
    const L = lTable[bestAge] ?? 0.3
    return { age, ...backCalcLMS(sd2neg, median, L) }
  })
}

// WHZ uses height (cm) as x-axis instead of age
function deriveWHZLMS(bands, L = 0.35) {
  return bands.map(([height, , sd2neg, median]) => {
    const M = median
    const S = (1 - Math.pow(sd2neg / M, L)) / (2 * L)
    return { height, L: round4(L), M: round4(M), S: round4(S) }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

const girlsHAZPath = path.join(root, 'src/data/who/lhfa-girls-expanded.xlsx')
const boysHAZPath  = path.join(root, 'src/data/who/lhfa-boys-expanded.xlsx')

console.log('Parsing girls HAZ Excel...')
const girlsHAZ = parseHAZTable(girlsHAZPath)
console.log(`  → ${girlsHAZ.length} rows`)
const g24 = girlsHAZ.find(r => r.age === 24)
console.log(`  Girls HAZ at 24m:`, g24)

console.log('Parsing boys HAZ Excel...')
const boysHAZ = parseHAZTable(boysHAZPath)
console.log(`  → ${boysHAZ.length} rows`)
const b12 = boysHAZ.find(r => r.age === 12)
console.log(`  Boys HAZ at 12m:`, b12)

console.log('Deriving WAZ LMS from SD bands...')
const girlsWAZ = deriveLMS(WFA_GIRLS_BANDS, WAZ_L_GIRLS)
const boysWAZ  = deriveLMS(WFA_BOYS_BANDS,  WAZ_L_BOYS)

console.log('Deriving WHZ LMS from SD bands...')
const girlsWHZ = deriveWHZLMS(WFH_GIRLS_BANDS, 0.3809)
const boysWHZ  = deriveWHZLMS(WFH_BOYS_BANDS,  0.3487)

// ── Verify ────────────────────────────────────────────────────────────────────

function getLMSValue(L, M, S, k) {
  if (Math.abs(L) < 0.001) return M * Math.exp(k * S)
  return M * Math.pow(1 + L * S * k, 1 / L)
}

const g24haz = girlsHAZ.find(r => r.age === 24)
if (g24haz) {
  const sd3neg = getLMSValue(g24haz.L, g24haz.M, g24haz.S, -3)
  const median = g24haz.M
  const sd3pos = getLMSValue(g24haz.L, g24haz.M, g24haz.S, 3)
  console.log('\nVerification — Girls HAZ at 24m:')
  console.log(`  L=${g24haz.L}, M=${g24haz.M} cm (median), S=${g24haz.S}`)
  console.log(`  -3SD=${sd3neg.toFixed(1)}, median=${median}, +3SD=${sd3pos.toFixed(1)}`)
  console.log(`  Expected: -3SD≈77cm, median≈87cm, +3SD≈97cm`)
}

// ── Write output ──────────────────────────────────────────────────────────────

const girlsOut = { _source: 'WHO Child Growth Standards 2006', haz: girlsHAZ, waz: girlsWAZ, whz: girlsWHZ }
const boysOut  = { _source: 'WHO Child Growth Standards 2006', haz: boysHAZ,  waz: boysWAZ,  whz: boysWHZ  }

fs.writeFileSync(path.join(root, 'src/data/who-lms-girls.json'), JSON.stringify(girlsOut, null, 2))
fs.writeFileSync(path.join(root, 'src/data/who-lms-boys.json'),  JSON.stringify(boysOut,  null, 2))

console.log('\n✓ Wrote src/data/who-lms-girls.json')
console.log('✓ Wrote src/data/who-lms-boys.json')
