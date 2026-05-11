import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useStore, store } from "@/lib/store";
import type { Patient, Submission } from "@/lib/store";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { Search, Plus, ChevronDown, ChevronRight } from "lucide-react";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts";
import {
  computeVisitZScores, applyPositionCorrection,
  buildHAZRef, buildWAZRef, zColor,
  type ChartRefPoint,
} from "@/lib/who-lms";
import {
  charts, refTables, interpolated, classify,
  type ChartKey, type Sex,
} from "@/lib/who-growth";

export const Route = createFileRoute("/tools/growth")({ component: GrowthTool });

// ── Constants ──────────────────────────────────────────────────────────────────

const GROWTH_FORM_ID = "__growth_visit__";
const GROWTH_FORM_NAME = "Growth Visit";
const chartOrder: ChartKey[] = ["wfa", "hfa", "wfh", "bfa", "muac", "hcfa"];

// ── Age helpers ────────────────────────────────────────────────────────────────

function computeAgeInMonthsAt(dob: string, atDate: string): number {
  const b = new Date(dob);
  const d = new Date(atDate);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months -= 1;
  return Math.max(0, months);
}

function computeAgeInMonths(dob: string): number {
  return computeAgeInMonthsAt(dob, new Date().toISOString().slice(0, 10));
}

function computeAgeText(dob: string): string {
  const months = computeAgeInMonths(dob);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}M`;
  if (m === 0) return `${y}Y`;
  return `${y}Y ${m}M`;
}

function expectedHeightRange(ageMonths: number): string {
  const ranges: [number, string][] = [
    [0, "47–53"], [3, "57–65"], [6, "62–71"], [9, "67–76"], [12, "71–80"],
    [18, "77–86"], [24, "81–92"], [30, "86–97"], [36, "89–101"],
    [42, "93–105"], [48, "96–108"], [60, "102–116"],
  ];
  return ranges.reduce((a, b) =>
    Math.abs(a[0] - ageMonths) < Math.abs(b[0] - ageMonths) ? a : b,
  )[1];
}

// ── Visit data ─────────────────────────────────────────────────────────────────

interface GrowthVisitData {
  visitDate: string;
  ageMonths: number;
  weight: number;
  height: number;
  isLying: boolean;
  muac?: number;
  edema: boolean;
  waz: number | null;
  haz: number | null;
  whz: number | null;
  isSAM: boolean;
  isMAM: boolean;
  samCriteria: string;
}

type GrowthVisit = GrowthVisitData & { id: string; createdAt: number };

function getVisits(submissions: Submission[], patientId: string): GrowthVisit[] {
  return submissions
    .filter((s) => s.formId === GROWTH_FORM_ID && s.patientId === patientId)
    .map((s) => ({ id: s.id, createdAt: s.createdAt, ...(s.data as unknown as GrowthVisitData) }))
    .sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime());
}

function fmt(z: number | null): string {
  if (z === null || isNaN(z)) return "—";
  return (z > 0 ? "+" : "") + z.toFixed(2);
}

function classifyZ(key: string, z: number | null): string {
  if (z === null || isNaN(z)) return "—";
  if (key === "WAZ") {
    if (z < -3) return "Sev. Underweight";
    if (z < -2) return "Underweight";
    if (z > 2) return "Overweight";
    return "Normal";
  }
  if (key === "HAZ") {
    if (z < -3) return "Sev. Stunted";
    if (z < -2) return "Stunted";
    if (z > 2) return "Tall";
    return "Normal";
  }
  if (z < -3) return "SAM";
  if (z < -2) return "MAM";
  if (z > 2) return "Overweight";
  return "Normal";
}

// ── Main component ─────────────────────────────────────────────────────────────

function GrowthTool() {
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Quick calculator state — preserved across accordion interactions
  const [chartKey, setChartKey] = useState<ChartKey>("wfa");
  const [sex, setSex] = useState<Sex>("boys");
  const [pointsByChart, setPointsByChart] = useState<Record<ChartKey, { x: number; y: number }[]>>(
    () => Object.fromEntries(chartOrder.map((k) => [k, []])) as unknown as Record<ChartKey, { x: number; y: number }[]>,
  );
  const [xVal, setXVal] = useState(12);
  const [yVal, setYVal] = useState(9);

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const active = patients.filter((p) => p.status === "Active");
    if (!q) return active;
    return active.filter(
      (p) => p.name.toLowerCase().includes(q) || p.village.toLowerCase().includes(q),
    );
  }, [patients, searchQuery]);

  return (
    <>
      <PageHeader
        title="Growth Chart"
        back="/tools"
        variant="yellow"
        subtitle="WHO 2006 · 0–60 months · longitudinal tracker"
      />
      <PageShell>

        {/* ── SECTION A: Tracked Patients ──────────────────────────── */}
        <SectionTitle kicker="A">Tracked Patients</SectionTitle>

        <div className="mb-3 flex gap-2">
          <button
            className="btn-brutal flex shrink-0 items-center gap-1.5 text-xs"
            onClick={() => { setShowAddPatient(true); setExpandedId(null); }}
          >
            <Plus className="h-3.5 w-3.5" /> Track new patient
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search name or village…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-brutal w-full pl-8 text-xs"
            />
          </div>
        </div>

        {showAddPatient && (
          <AddPatientForm
            onSave={(p) => { setShowAddPatient(false); setExpandedId(p.id); }}
            onCancel={() => setShowAddPatient(false)}
          />
        )}

        {filteredPatients.length === 0 && !showAddPatient ? (
          <div className="brutal-flat mb-4 p-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {searchQuery
              ? `No patients match "${searchQuery}"`
              : "No patients tracked yet — tap + Track new patient to begin."}
          </div>
        ) : (
          <ul className="mb-6 grid gap-2">
            {filteredPatients.map((patient) => (
              <PatientAccordion
                key={patient.id}
                patient={patient}
                visits={getVisits(submissions, patient.id)}
                isExpanded={expandedId === patient.id}
                onToggle={() => setExpandedId(expandedId === patient.id ? null : patient.id)}
              />
            ))}
          </ul>
        )}

        {/* ── SECTION B: Quick Calculator ──────────────────────────── */}
        <SectionTitle kicker="B">Quick Z-Score Calculator</SectionTitle>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          One-off calculation — results not saved to any patient record.
        </p>
        <QuickCalculator
          chartKey={chartKey}
          sex={sex}
          xVal={xVal}
          yVal={yVal}
          pointsByChart={pointsByChart}
          onChartKey={(k) => { setChartKey(k); setXVal(initialX(k)); setYVal(initialY(k)); }}
          onSex={setSex}
          onXVal={setXVal}
          onYVal={setYVal}
          onPointsByChart={setPointsByChart}
        />

      </PageShell>
    </>
  );
}

// ── PatientAccordion ───────────────────────────────────────────────────────────

function PatientAccordion({
  patient, visits, isExpanded, onToggle,
}: {
  patient: Patient;
  visits: GrowthVisit[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [showAddVisit, setShowAddVisit] = useState(false);
  const latest = visits.length > 0 ? visits[visits.length - 1] : null;
  const overallStatus = latest?.isSAM ? "SAM" : latest?.isMAM ? "MAM" : latest ? "Normal" : "No data";
  const statusColor = overallStatus === "SAM" ? "#dc2626" : overallStatus === "MAM" ? "#f59e0b" : overallStatus === "Normal" ? "#16a34a" : "#9ca3af";
  const hasSuspectHeight = visits.some((v) => v.height < 30);
  const sexLabel = patient.sex === "Male" ? "♂" : "♀";

  return (
    <li className="brutal">
      {/* Collapsed header */}
      <button
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-primary/10 transition-colors"
        onClick={onToggle}
      >
        {isExpanded
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm uppercase leading-tight">{patient.name}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              {sexLabel} · {computeAgeText(patient.dob)}{patient.village ? ` · ${patient.village}` : ""}
            </span>
          </div>
          {latest && (
            <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">
              WAZ: <span style={{ color: zColor(latest.waz) }}>{fmt(latest.waz)}</span>
              {" "}HAZ: <span style={{ color: zColor(latest.haz) }}>{fmt(latest.haz)}</span>
              {" "}WHZ: <span style={{ color: zColor(latest.whz) }}>{fmt(latest.whz)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: statusColor, borderColor: statusColor }}>
            {overallStatus}
          </span>
          <span className="text-[9px] text-muted-foreground">{visits.length} visit{visits.length !== 1 ? "s" : ""}</span>
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="space-y-3 border-t-2 border-border p-3">

          {hasSuspectHeight && (
            <div className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
              ⚠ One or more visits have a height below 30 cm — likely a data entry error (e.g. MUAC value entered in the height field). Please add a corrected visit.
            </div>
          )}

          {latest?.isSAM && (
            <div className="border-2 border-destructive bg-destructive/10 px-3 py-2 text-[11px] font-bold text-destructive">
              ⚠ SEVERE ACUTE MALNUTRITION — Refer to NRC immediately · {latest.samCriteria}
            </div>
          )}

          {!latest?.isSAM && latest?.isMAM && (
            <div className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
              ⚠ Moderate Acute Malnutrition — monitor closely, nutritional support indicated
            </div>
          )}

          {latest && <ZScoreCards latest={latest} />}

          <div className="flex gap-2">
            <button
              className="btn-brutal flex-1 text-xs"
              onClick={() => setShowAddVisit((v) => !v)}
            >
              {showAddVisit ? "Cancel" : "+ Add visit"}
            </button>
            <Link
              to="/patients/$id"
              params={{ id: patient.id }}
              className="border-2 border-border bg-card px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20"
            >
              Full profile →
            </Link>
          </div>

          {showAddVisit && (
            <AddVisitForm
              patient={patient}
              onSave={() => setShowAddVisit(false)}
              onCancel={() => setShowAddVisit(false)}
            />
          )}

          {visits.length > 0 && <InlineCharts patient={patient} visits={visits} />}
          {visits.length > 0 && <VisitTable visits={visits} />}
        </div>
      )}
    </li>
  );
}

// ── Z-score cards ──────────────────────────────────────────────────────────────

function ZScoreCards({ latest }: { latest: GrowthVisitData }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {(["WAZ", "HAZ", "WHZ"] as const).map((key) => {
        const z = key === "WAZ" ? latest.waz : key === "HAZ" ? latest.haz : latest.whz;
        const color = zColor(z);
        return (
          <div key={key} className="border-2 p-2 text-center" style={{ borderColor: color }}>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{key}</div>
            <div className="mt-0.5 font-display text-xl leading-tight" style={{ color }}>{fmt(z)}</div>
            <div className="text-[9px] font-bold uppercase" style={{ color }}>{classifyZ(key, z)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Inline WHO Charts ──────────────────────────────────────────────────────────

function InlineCharts({ patient, visits }: { patient: Patient; visits: GrowthVisit[] }) {
  const sex = patient.sex === "Male" ? "M" : "F";
  const ages = visits.map((v) => v.ageMonths);
  const ageMin = Math.max(0, Math.min(...ages) - 2);
  const ageMax = Math.min(60, Math.max(...ages) + 2);

  const hazRef = useMemo(() => buildHAZRef(sex, ageMin, ageMax), [sex, ageMin, ageMax]);
  const wazRef = useMemo(() => buildWAZRef(sex, ageMin, ageMax), [sex, ageMin, ageMax]);

  const hazPts = visits
    .filter((v) => v.height >= 30)
    .map((v) => ({ age: v.ageMonths, child: v.height }));

  const wazPts = visits.map((v) => ({ age: v.ageMonths, child: v.weight }));

  return (
    <div className="space-y-3">
      <MiniWHOChart title="Height-for-Age" refData={hazRef} childPts={hazPts} unit="cm" />
      <MiniWHOChart title="Weight-for-Age" refData={wazRef} childPts={wazPts} unit="kg" />
    </div>
  );
}

function MiniWHOChart({
  title, refData, childPts, unit,
}: {
  title: string;
  refData: ChartRefPoint[];
  childPts: { age: number; child: number }[];
  unit: string;
}) {
  const chartData = useMemo(() => {
    const byAge = new Map<number, { age: number; sd3n: number; sd2n: number; med: number; sd2p: number; sd3p: number; child?: number }>();
    refData.forEach((r) => byAge.set(r.age, { age: r.age, sd3n: r.sd3n, sd2n: r.sd2n, med: r.med, sd2p: r.sd2p, sd3p: r.sd3p }));
    childPts.forEach((p) => {
      const base = byAge.get(p.age);
      if (base) byAge.set(p.age, { ...base, child: p.child });
      else byAge.set(p.age, { age: p.age, sd3n: 0, sd2n: 0, med: 0, sd2p: 0, sd3p: 0, child: p.child });
    });
    return Array.from(byAge.values()).sort((a, b) => a.age - b.age);
  }, [refData, childPts]);

  if (chartData.length === 0) return null;

  const finite = chartData
    .flatMap((d) => [d.sd3n, d.sd3p, d.child ?? null])
    .filter((v): v is number => v !== null && isFinite(v) && v > 0);
  if (finite.length === 0) return null;
  const yMin = Math.floor(Math.min(...finite) * 0.96);
  const yMax = Math.ceil(Math.max(...finite) * 1.02);

  return (
    <div className="brutal p-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest">{title} ({unit})</div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="age" type="number" domain={["dataMin", "dataMax"]} fontSize={9} stroke="var(--foreground)" label={{ value: "months", position: "insideBottom", offset: -4, fontSize: 9 }} />
            <YAxis domain={[yMin, yMax]} fontSize={9} stroke="var(--foreground)" />
            <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 10 }} formatter={(v: number) => `${v} ${unit}`} />
            <Line type="monotone" dataKey="sd3n" stroke="#dc2626" dot={false} strokeWidth={1} strokeDasharray="3 2" name="-3 SD" />
            <Line type="monotone" dataKey="sd2n" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="3 2" name="-2 SD" />
            <Line type="monotone" dataKey="med" stroke="#16a34a" dot={false} strokeWidth={1.5} name="Median" />
            <Line type="monotone" dataKey="sd2p" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="3 2" name="+2 SD" />
            <Line type="monotone" dataKey="sd3p" stroke="#dc2626" dot={false} strokeWidth={1} strokeDasharray="3 2" name="+3 SD" />
            <Line type="monotone" dataKey="child" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--primary)", stroke: "var(--border)", strokeWidth: 1.5 }} connectNulls name={`Child (${unit})`} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Visit history table ────────────────────────────────────────────────────────

function VisitTable({ visits }: { visits: GrowthVisit[] }) {
  return (
    <div className="overflow-x-auto border-2 border-border">
      <table className="min-w-full border-collapse text-[10px]">
        <thead className="bg-[#171e19] text-white">
          <tr>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider">Date</th>
            <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wider">Age</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">Wt kg</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">Ht cm</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">MUAC</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">WAZ</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">HAZ</th>
            <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wider">WHZ</th>
          </tr>
        </thead>
        <tbody>
          {[...visits].reverse().map((v, i) => (
            <tr key={v.id} className="border-b border-border" style={{ background: i % 2 === 0 ? "var(--background)" : "var(--muted)" }}>
              <td className="px-2 py-1.5">
                {new Date(v.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">{v.ageMonths}m</td>
              <td className="px-2 py-1.5 text-right font-mono">{v.weight}</td>
              <td className={`px-2 py-1.5 text-right font-mono ${v.height < 30 ? "font-bold text-destructive" : ""}`}>
                {v.height}{v.height < 30 ? " ⚠" : ""}
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{v.muac ?? "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.waz) }}>{fmt(v.waz)}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.haz) }}>{fmt(v.haz)}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.whz) }}>{fmt(v.whz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Add Patient Form ───────────────────────────────────────────────────────────

function AddPatientForm({ onSave, onCancel }: {
  onSave: (p: Patient) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState<"Male" | "Female">("Male");
  const [village, setVillage] = useState("");
  const [phone, setPhone] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const handleSave = () => {
    if (!name.trim()) { alert("Name is required."); return; }
    if (!dob) { alert("Date of birth is required."); return; }
    const p = store.addPatient({ name: name.trim(), dob, sex, village, phone: phone || undefined });
    onSave(p);
  };

  return (
    <div className="brutal mb-3 space-y-3 p-4">
      <div className="font-display text-sm uppercase tracking-widest">Track new patient</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Full name *</label>
          <input type="text" className="input-brutal w-full" placeholder="e.g. Rohit Kumar" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Date of birth *</label>
          <input type="date" className="input-brutal w-full" value={dob} max={today} onChange={(e) => setDob(e.target.value)} />
          {dob && <p className="mt-0.5 text-[10px] text-muted-foreground">Age: {computeAgeText(dob)}</p>}
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Sex *</label>
          <div className="flex gap-2">
            {(["Male", "Female"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSex(s)}
                className={`flex-1 border-2 border-border py-2 text-[10px] font-bold uppercase tracking-wider ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Village</label>
          <input type="text" className="input-brutal w-full" placeholder="e.g. Raiwala" value={village} onChange={(e) => setVillage(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Phone (optional)</label>
          <input type="tel" className="input-brutal w-full" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-brutal flex-1" onClick={handleSave}>Save & track →</button>
      </div>
    </div>
  );
}

// ── Add Visit Form ─────────────────────────────────────────────────────────────

function AddVisitForm({ patient, onSave, onCancel }: {
  patient: Patient;
  onSave: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [muac, setMuac] = useState("");
  const [edema, setEdema] = useState(false);
  const [isLying, setIsLying] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const ageAtVisit = useMemo(() => computeAgeInMonthsAt(patient.dob, visitDate), [patient.dob, visitDate]);

  // Auto-suggest lying/standing when age changes
  useEffect(() => { setIsLying(ageAtVisit < 24); }, [ageAtVisit]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const m = muac ? parseFloat(muac) : null;

    if (!weight || isNaN(w) || w <= 0) {
      errs.weight = "Weight is required.";
    } else if (w < 0.5 || w > 60) {
      errs.weight = `Weight ${w} kg is outside the valid range (0.5–60 kg). Please check your entry.`;
    }

    if (!height || isNaN(h) || h <= 0) {
      errs.height = "Height / Length is required.";
    } else if (h < 30 || h > 130) {
      errs.height = `Height ${h} cm is outside the valid range (30–130 cm for children under 5).`
        + (h < 30 ? ` Did you enter MUAC (${h} cm) in the height field by mistake?` : "");
    }

    if (muac && m !== null && (m < 7 || m > 30)) {
      errs.muac = `MUAC ${m} cm is outside the valid range (7–30 cm).`;
    }

    if (visitDate < patient.dob) errs.visitDate = "Visit date cannot be before the patient's date of birth.";
    if (visitDate > today) errs.visitDate = "Visit date cannot be in the future.";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const m = muac ? parseFloat(muac) : undefined;

    const correctedH = applyPositionCorrection(h, ageAtVisit, isLying);
    const zScores = computeVisitZScores(patient.sex, ageAtVisit, w, correctedH, m, edema);

    store.addSubmission({
      patientId: patient.id,
      formId: GROWTH_FORM_ID,
      formName: GROWTH_FORM_NAME,
      data: {
        visitDate,
        ageMonths: ageAtVisit,
        weight: w,
        height: h,
        isLying,
        muac: m,
        edema,
        waz: zScores.waz,
        haz: zScores.haz,
        whz: zScores.whz,
        isSAM: zScores.isSAM,
        isMAM: zScores.isMAM,
        samCriteria: zScores.samCriteria,
      },
    });

    onSave();
  }

  return (
    <div className="border-2 border-border p-3 space-y-3">
      <div className="font-display text-sm uppercase tracking-widest">Add visit — {patient.name}</div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Date of visit</label>
        <input type="date" className={`input-brutal w-full ${errors.visitDate ? "border-destructive" : ""}`}
          value={visitDate} min={patient.dob} max={today}
          onChange={(e) => setVisitDate(e.target.value)} />
        {errors.visitDate
          ? <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.visitDate}</p>
          : <p className="mt-0.5 text-[10px] text-muted-foreground">Age at this visit: {ageAtVisit} months · backdating allowed</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Weight */}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Weight (kg) *</label>
          <input type="number" step="0.1" min="0.5" max="60"
            className={`input-brutal w-full font-mono ${errors.weight ? "border-destructive" : ""}`}
            placeholder="e.g. 10.5" value={weight}
            onChange={(e) => setWeight(e.target.value)} />
          {errors.weight && <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.weight}</p>}
        </div>

        {/* Height */}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">
            {ageAtVisit < 24 ? "Length (cm) — lying *" : "Height (cm) — standing *"}
          </label>
          <input type="number" step="0.1" min="30" max="130"
            className={`input-brutal w-full font-mono ${errors.height ? "border-destructive" : ""}`}
            placeholder={`e.g. ${expectedHeightRange(ageAtVisit).split("–")[0]} cm`}
            value={height}
            onChange={(e) => setHeight(e.target.value)} />
          {errors.height
            ? <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.height}</p>
            : <p className="mt-0.5 text-[10px] text-muted-foreground">Expected at {ageAtVisit}m: {expectedHeightRange(ageAtVisit)} cm</p>}
        </div>

        {/* MUAC */}
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">MUAC (cm) — optional</label>
          <input type="number" step="0.1" min="7" max="30"
            className={`input-brutal w-48 font-mono ${errors.muac ? "border-destructive" : ""}`}
            placeholder="e.g. 13.5" value={muac}
            onChange={(e) => setMuac(e.target.value)} />
          {errors.muac
            ? <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.muac}</p>
            : <p className="mt-0.5 text-[10px] text-muted-foreground">Mid-upper arm circumference (left arm, midpoint). SAM threshold: &lt;11.5 cm.</p>}
        </div>
      </div>

      {/* Position */}
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Measurement position</label>
        <div className="flex gap-2">
          {(["Lying", "Standing"] as const).map((pos) => {
            const active = pos === "Lying" ? isLying : !isLying;
            return (
              <button key={pos} type="button" onClick={() => setIsLying(pos === "Lying")}
                className={`flex-1 border-2 border-border py-2 text-[10px] font-bold uppercase tracking-wider ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
                {pos}
              </button>
            );
          })}
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {ageAtVisit < 24
            ? "Under 24 months: measure lying. If standing was used, +0.7 cm added before Z-score calculation."
            : "24+ months: measure standing. If lying was used, −0.7 cm applied before Z-score calculation."}
        </p>
      </div>

      {/* Oedema */}
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Bilateral pitting oedema</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEdema(false)}
            className={`flex-1 border-2 border-border py-2 text-[10px] font-bold uppercase tracking-wider ${!edema ? "bg-primary" : "bg-card hover:bg-primary/30"}`}>
            No
          </button>
          <button type="button" onClick={() => setEdema(true)}
            className={`flex-1 border-2 py-2 text-[10px] font-bold uppercase tracking-wider ${edema ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-card hover:bg-destructive/10"}`}>
            Yes — present
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-brutal flex-1" onClick={handleSave}>Save visit & update chart</button>
      </div>
    </div>
  );
}

// ── Quick Calculator (Section B — existing functionality preserved) ─────────────

function QuickCalculator({
  chartKey, sex, xVal, yVal, pointsByChart,
  onChartKey, onSex, onXVal, onYVal, onPointsByChart,
}: {
  chartKey: ChartKey; sex: Sex; xVal: number; yVal: number;
  pointsByChart: Record<ChartKey, { x: number; y: number }[]>;
  onChartKey: (k: ChartKey) => void;
  onSex: (s: Sex) => void;
  onXVal: (v: number) => void;
  onYVal: (v: number) => void;
  onPointsByChart: (fn: (p: Record<ChartKey, { x: number; y: number }[]>) => Record<ChartKey, { x: number; y: number }[]>) => void;
}) {
  const meta = charts[chartKey];
  const points = pointsByChart[chartKey];
  const ref = refTables[chartKey][sex];

  const data = useMemo(() => {
    const map = new Map<number, { x: number; SDneg2: number; median: number; SDpos2: number; child?: number }>();
    ref.forEach((r) => map.set(r.x, { x: r.x, SDneg2: r.SDneg2, median: r.median, SDpos2: r.SDpos2 }));
    points.forEach((p) => {
      const base = map.get(p.x) ?? interpolated(ref, p.x);
      map.set(p.x, { x: p.x, SDneg2: base.SDneg2, median: base.median, SDpos2: base.SDpos2, child: p.y });
    });
    return Array.from(map.values()).sort((a, b) => a.x - b.x);
  }, [ref, points]);

  const cls = useMemo(() => {
    const i = interpolated(ref, xVal);
    return classify(chartKey, i, yVal);
  }, [ref, xVal, yVal, chartKey]);

  const addPoint = () =>
    onPointsByChart((prev) => {
      const arr = (prev[chartKey] ?? []).filter((p) => p.x !== xVal);
      return { ...prev, [chartKey]: [...arr, { x: xVal, y: yVal }].sort((a, b) => a.x - b.x) };
    });

  const clearPoints = () => onPointsByChart((prev) => ({ ...prev, [chartKey]: [] }));

  const xInputLabel =
    chartKey === "bfa" ? "Age (years)" : chartKey === "wfh" ? "Height (cm)" : "Age (months)";

  return (
    <div className="space-y-4">
      <div className="brutal grid grid-cols-3 overflow-hidden">
        {chartOrder.map((k, i) => (
          <button key={k} onClick={() => onChartKey(k)}
            className={`px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider ${chartKey === k ? "bg-primary" : "bg-card hover:bg-primary/30"} ${i % 3 !== 2 ? "border-r-2 border-border" : ""} ${i < 3 ? "border-b-2 border-border" : ""}`}>
            {charts[k].shortLabel}
          </button>
        ))}
      </div>

      <div className="brutal grid grid-cols-2">
        {(["boys", "girls"] as const).map((s, i) => (
          <button key={s} onClick={() => onSex(s)}
            className={`px-3 py-3 text-sm font-bold uppercase tracking-wide ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"} ${i === 0 ? "border-r-2 border-border" : ""}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="brutal space-y-3 p-4">
        <SectionTitle kicker="Plot">Add point</SectionTitle>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider">{xInputLabel}</span>
          <input type="number" value={xVal}
            step={chartKey === "bfa" ? 1 : meta.xUnit === "cm" ? 0.5 : 1}
            min={meta.xMin} max={meta.xMax}
            onChange={(e) => onXVal(Number(e.target.value))}
            className="input-brutal w-32 text-right font-mono" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider">{meta.yLabel}</span>
          <input type="number" value={yVal} step={meta.yStep} min={0} max={300}
            onChange={(e) => onYVal(Number(e.target.value))}
            className="input-brutal w-32 text-right font-mono" />
        </label>
        <button onClick={addPoint} className="btn-brutal w-full">Add to chart</button>
        {points.length > 0 && (
          <button onClick={clearPoints} className="text-[11px] font-bold uppercase tracking-wider underline">
            Clear points ({points.length})
          </button>
        )}
      </div>

      <div className="brutal p-3">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="x" type="number" domain={[meta.xMin, meta.xMax]} stroke="var(--foreground)" fontSize={10}
                label={{ value: meta.xLabel, position: "insideBottom", offset: -2, fontSize: 10 }} />
              <YAxis stroke="var(--foreground)" fontSize={10} />
              <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="SDneg2" stroke="var(--destructive)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="−2 SD" />
              <Line type="monotone" dataKey="median" stroke="var(--secondary)" dot={false} strokeWidth={2} name="Median" />
              <Line type="monotone" dataKey="SDpos2" stroke="var(--chart-5)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="+2 SD" />
              <Line type="monotone" dataKey="child" stroke="var(--primary)" strokeWidth={3}
                dot={{ r: 4, stroke: "var(--secondary)", strokeWidth: 2, fill: "var(--primary)" }}
                connectNulls name="Child" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`brutal-lg p-4 ${cls.tone === "success" ? "bg-success" : cls.tone === "warning" ? "bg-primary" : "bg-destructive text-destructive-foreground"}`}>
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">
          {meta.label} · current input
        </div>
        <div className="mt-1 font-display text-3xl uppercase leading-none">{cls.label}</div>
      </div>

      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Reference values approximate WHO standards (0–5 y) and 2007 references (5–19 y). For screening only.
      </p>
    </div>
  );
}

function initialX(k: ChartKey): number {
  switch (k) {
    case "bfa": return 10;
    case "wfh": return 80;
    default: return 12;
  }
}

function initialY(k: ChartKey): number {
  switch (k) {
    case "wfa": return 9;
    case "hfa": return 75;
    case "wfh": return 10;
    case "bfa": return 16;
    case "muac": return 14;
    case "hcfa": return 46;
  }
}
