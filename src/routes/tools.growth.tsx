import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, store, sync } from "@/lib/store";
import type { Patient, Submission } from "@/lib/store";
import { useAuthGate } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { Search, Plus, ChevronDown, ChevronRight, Trash2, Pencil, Download, Share2, X } from "lucide-react";
import { API_BASE, getToken } from "@/lib/api";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, ReferenceLine,
} from "recharts";
import {
  computeVisitZScores, applyPositionCorrection,
  buildHAZRef, buildWAZRef, zColor,
  type ChartRefPoint,
} from "@/lib/who-lms";

export const Route = createFileRoute("/tools/growth")({ component: GrowthTool });

// ── Constants ──────────────────────────────────────────────────────────────────

const GROWTH_FORM_ID = "__growth_visit__";
const GROWTH_FORM_NAME = "Growth Visit";

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

function ageLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}m`;
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
  const [justAdded, setJustAdded] = useState<Patient | null>(null);
  const { gate, requireAuth } = useAuthGate({ action: "track a patient" });

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const active = patients.filter((p) => p.status === "Active");
    if (!q) return active;
    return active.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.village.toLowerCase().includes(q) ||
        (p.guardianName ?? "").toLowerCase().includes(q),
    );
  }, [patients, searchQuery]);

  const showList = searchQuery.trim().length > 0;

  return (
    <>
      {gate}
      <PageHeader
        title="Growth Chart"
        back="/tools"
        variant="yellow"
        subtitle="WHO 2006 · 0–60 months · longitudinal tracker"
      />
      <PageShell>

        {/* ── SECTION A: Patient search ──────────────────────────── */}
        <SectionTitle kicker="A">Tracked Patients</SectionTitle>

        <div className="mb-3 flex gap-2">
          <button
            className="btn-brutal flex shrink-0 items-center gap-1.5 text-xs"
            onClick={() => requireAuth(() => { setShowAddPatient(true); setExpandedId(null); setSearchQuery(""); setJustAdded(null); })}
          >
            <Plus className="h-3.5 w-3.5" /> Track new patient
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search name or village…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowAddPatient(false); setJustAdded(null); }}
              className="input-brutal w-full pl-8 text-xs"
            />
          </div>
        </div>

        {showAddPatient && (
          <AddPatientForm
            onSave={(p) => {
              setShowAddPatient(false);
              setJustAdded(p);
              setExpandedId(p.id);
              setSearchQuery("");
            }}
            onCancel={() => setShowAddPatient(false)}
          />
        )}

        {/* Just-added patient — shown immediately with Add Visit pre-opened */}
        {justAdded && !showAddPatient && (
          <div className="mb-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-primary">
              ✓ Patient added — record their first visit below
            </div>
            <ul className="grid gap-2">
              <PatientAccordion
                key={justAdded.id}
                patient={justAdded}
                visits={getVisits(submissions, justAdded.id)}
                isExpanded
                openAddVisit
                onToggle={() => {}}
                onVisitSaved={() => setJustAdded(null)}
              />
            </ul>
          </div>
        )}

        {/* Patient list — only when searching */}
        {showList && !showAddPatient && !justAdded && (
          filteredPatients.length === 0 ? (
            <div className="brutal-flat mb-4 p-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
              No patients match "{searchQuery}"
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
          )
        )}

        {/* Idle state — no search yet */}
        {!showList && !showAddPatient && !justAdded && (
          <div className="brutal-flat mb-6 flex flex-col items-center gap-2 py-8 text-center">
            <Search className="h-8 w-8 opacity-20" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Search a patient by name or village to view their chart
            </p>
            <p className="text-[10px] text-muted-foreground">
              {patients.filter((p) => p.status === "Active").length} patient
              {patients.filter((p) => p.status === "Active").length !== 1 ? "s" : ""} tracked
            </p>
          </div>
        )}

        {/* ── SECTION B: Quick Z-Score Calculator ──────────────── */}
        <SectionTitle kicker="B">Quick Z-Score Calculator</SectionTitle>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          One-off calculation — results not saved to any patient record.
        </p>
        <QuickCalculator />

        {/* ── SECTION C: MUAC Screening ────────────────────────── */}
        <div className="mt-8">
          <SectionTitle kicker="C">MUAC Screening</SectionTitle>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Children 6–59 months · WHO 2009 thresholds
          </p>
          <MUACScreening />
        </div>

      </PageShell>
    </>
  );
}

// ── PatientAccordion ───────────────────────────────────────────────────────────

function PatientAccordion({
  patient, visits, isExpanded, onToggle, openAddVisit = false, onVisitSaved,
}: {
  patient: Patient;
  visits: GrowthVisit[];
  isExpanded: boolean;
  onToggle: () => void;
  openAddVisit?: boolean;
  onVisitSaved?: () => void;
}) {
  const [showAddVisit, setShowAddVisit] = useState(openAddVisit);
  const { gate: visitGate, requireAuth: requireVisitAuth } = useAuthGate({ action: "add a visit" });
  const [editingVisit, setEditingVisit] = useState<GrowthVisit | null>(null);
  const [showSharePanel, setShowSharePanel] = useState(false);

  // Live share token from store (updates after generate/revoke without needing prop drilling)
  const shareToken = useStore((s) => s.patients.find((p) => p.id === patient.id)?.shareToken);

  const latest = visits.length > 0 ? visits[visits.length - 1] : null;
  const overallStatus = latest?.isSAM ? "SAM" : latest?.isMAM ? "MAM" : latest ? "Normal" : "No data";
  const statusColor = overallStatus === "SAM" ? "#dc2626" : overallStatus === "MAM" ? "#f59e0b" : overallStatus === "Normal" ? "#16a34a" : "#9ca3af";
  const hasSuspectHeight = visits.some((v) => v.height < 30);
  const sexLabel = patient.sex === "Male" ? "♂" : "♀";

  function handleDownload() {
    const sortedVisits = [...visits].sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime());
    const rows = sortedVisits.map((v) => {
      const status = v.isSAM ? "SAM" : v.isMAM ? "MAM" : "Normal";
      const color = v.isSAM ? "#dc2626" : v.isMAM ? "#f59e0b" : "#16a34a";
      return `<tr>
        <td>${new Date(v.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
        <td>${ageLabel(v.ageMonths)}</td>
        <td>${v.weight}</td>
        <td>${v.height}</td>
        <td>${v.muac ?? "—"}</td>
        <td>${fmt(v.waz)}</td>
        <td>${fmt(v.haz)}</td>
        <td>${fmt(v.whz)}</td>
        <td style="color:${color};font-weight:bold">${status}</td>
      </tr>`;
    }).join("");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Growth Chart — ${patient.name}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 20px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 4px; }
    .sub { font-size: 12px; color: #666; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1a1a1a; color: #fff; padding: 6px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
    td { padding: 5px 10px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) { background: #f9f9f9; }
    .footer { margin-top: 16px; font-size: 10px; color: #999; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${patient.name}</h1>
  <div class="sub">
    DOB: ${patient.dob} &nbsp;·&nbsp; ${patient.sex}
    ${patient.guardianName ? `&nbsp;·&nbsp; s/o · d/o ${patient.guardianName}` : ""}
    ${patient.village ? `&nbsp;·&nbsp; ${patient.village}` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Age</th><th>Wt (kg)</th><th>Ht (cm)</th>
        <th>MUAC (cm)</th><th>WAZ</th><th>HAZ</th><th>WHZ</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    Reference: WHO 2006 standards (0–5 years) · CommunityMed Pro · Generated ${new Date().toLocaleDateString()}
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) { alert("Please allow pop-ups to print the growth chart."); return; }
    win.document.write(html);
    win.document.close();
  }

  function handleDeleteVisit(id: string) {
    if (window.confirm("Delete this visit? This cannot be undone.")) {
      store.deleteSubmission(id);
    }
  }

  return (
    <li className="brutal">
      {visitGate}
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
          {patient.guardianName && (
            <div className="text-[9px] text-muted-foreground">
              s/o · d/o {patient.guardianName}
            </div>
          )}
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

      {isExpanded && (
        <div className="space-y-3 border-t-2 border-border p-3">

          {hasSuspectHeight && (
            <div className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
              ⚠ One or more visits have a height below 30 cm — likely a data entry error. Edit or delete the affected visit.
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-brutal flex-1 text-xs"
              onClick={() => requireVisitAuth(() => { setShowAddVisit((v) => !v); setEditingVisit(null); })}
            >
              {showAddVisit ? "Cancel" : "+ Add visit"}
            </button>
            {visits.length > 0 && (
              <button
                className="flex items-center gap-1.5 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                onClick={handleDownload}
                title="Print / Save as PDF"
              >
                <Download className="h-3.5 w-3.5" /> Print
              </button>
            )}
            <button
              className={`flex items-center gap-1.5 border-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${showSharePanel ? "border-primary bg-primary/10" : "border-border hover:bg-primary/20"}`}
              onClick={() => setShowSharePanel((v) => !v)}
            >
              <Share2 className="h-3.5 w-3.5" /> Share
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
              onCancel={() => { setShowAddVisit(false); onVisitSaved?.(); }}
            />
          )}

          {editingVisit && (
            <EditVisitModal
              patient={patient}
              visit={editingVisit}
              onSave={() => setEditingVisit(null)}
              onCancel={() => setEditingVisit(null)}
            />
          )}

          {showSharePanel && (
            <PatientSharePanel
              patient={patient}
              shareToken={shareToken}
              onClose={() => setShowSharePanel(false)}
            />
          )}

          {visits.length > 0 && <InlineCharts patient={patient} visits={visits} />}
          {visits.length > 0 && (
            <VisitTable
              visits={visits}
              onEdit={(v) => { setEditingVisit(v); setShowAddVisit(false); }}
              onDelete={handleDeleteVisit}
            />
          )}
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

// ── AnthroPlus-style WHO Charts ────────────────────────────────────────────────

// SD line colors matching WHO AnthroPlus standard
const SD_COLORS = {
  sd3n: "#000000",   // −3 SD  black
  sd2n: "#cc0000",   // −2 SD  dark red
  sd1n: "#ff6600",   // −1 SD  orange
  med:  "#007700",   // 0 SD   dark green
  sd1p: "#ff6600",   // +1 SD  orange
  sd2p: "#ff8800",   // +2 SD  orange-red
  sd3p: "#cc0000",   // +3 SD  dark red
};

function InlineCharts({ patient, visits }: { patient: Patient; visits: GrowthVisit[] }) {
  const sex = patient.sex === "Male" ? "M" : "F";
  const isMale = sex === "M";
  // child data color: blue for boys, pink for girls (WHO standard)
  const childColor = isMale ? "#1d4ed8" : "#db2777";

  const ages = visits.map((v) => v.ageMonths);
  const ageMin = Math.max(0, Math.min(...ages) - 2);
  const ageMax = Math.min(60, Math.max(...ages) + 2);

  const hazRef = useMemo(() => buildHAZRef(sex, ageMin, ageMax), [sex, ageMin, ageMax]);
  const wazRef = useMemo(() => buildWAZRef(sex, ageMin, ageMax), [sex, ageMin, ageMax]);

  const hazPts = visits.filter((v) => v.height >= 30).map((v) => ({ age: v.ageMonths, child: v.height }));
  const wazPts = visits.map((v) => ({ age: v.ageMonths, child: v.weight }));

  return (
    <div className="space-y-4">
      <WHOChart
        title={`Height-for-Age ${isMale ? "BOYS" : "GIRLS"}`}
        subtitle="WHO 2006 · 0–60 months (z-scores)"
        refData={hazRef}
        childPts={hazPts}
        unit="cm"
        yLabel="Height (cm)"
        childColor={childColor}
        zones={[
          { y1Key: "sd3p", y2Key: "sd2p", fill: "#fee2e2", label: "Tall" },
          { y1Key: "sd2n", y2Key: "sd2p", fill: "#dcfce7", label: "Normal" },
          { y1Key: "sd3n", y2Key: "sd2n", fill: "#fef3c7", label: "Stunted" },
        ]}
      />
      <WHOChart
        title={`Weight-for-Age ${isMale ? "BOYS" : "GIRLS"}`}
        subtitle="WHO 2006 · 0–60 months (z-scores)"
        refData={wazRef}
        childPts={wazPts}
        unit="kg"
        yLabel="Weight (kg)"
        childColor={childColor}
        zones={[
          { y1Key: "sd2p", y2Key: "sd3p", fill: "#fee2e2", label: "Overweight" },
          { y1Key: "sd2n", y2Key: "sd2p", fill: "#dcfce7", label: "Normal" },
          { y1Key: "sd3n", y2Key: "sd2n", fill: "#fef3c7", label: "Underweight" },
        ]}
      />
    </div>
  );
}

interface ZoneSpec { y1Key: keyof ChartRefPoint; y2Key: keyof ChartRefPoint; fill: string; label: string; }

function WHOChart({
  title, subtitle, refData, childPts, unit, yLabel, childColor, zones,
}: {
  title: string; subtitle: string;
  refData: ChartRefPoint[];
  childPts: { age: number; child: number }[];
  unit: string; yLabel: string; childColor: string;
  zones: ZoneSpec[];
}) {
  const chartData = useMemo(() => {
    const byAge = new Map<number, Record<string, number>>();
    refData.forEach((r) => byAge.set(r.age, {
      age: r.age, sd3n: r.sd3n, sd2n: r.sd2n, sd1n: r.sd1n,
      med: r.med, sd1p: r.sd1p, sd2p: r.sd2p, sd3p: r.sd3p,
    }));
    childPts.forEach((p) => {
      const base = byAge.get(p.age) ?? { age: p.age, sd3n: 0, sd2n: 0, sd1n: 0, med: 0, sd1p: 0, sd2p: 0, sd3p: 0 };
      byAge.set(p.age, { ...base, child: p.child });
    });
    return Array.from(byAge.values()).sort((a, b) => a.age - b.age);
  }, [refData, childPts]);

  if (chartData.length === 0) return null;

  const finite = chartData.flatMap((d) => [d.sd3n, d.sd3p, d.child ?? null])
    .filter((v): v is number => v !== null && isFinite(v) && v > 0);
  if (finite.length === 0) return null;
  const yMin = Math.floor(Math.min(...finite) * 0.97);
  const yMax = Math.ceil(Math.max(...finite) * 1.02);

  const sdLines: { key: keyof typeof SD_COLORS; label: string; dash?: string; width?: number }[] = [
    { key: "sd3n", label: "−3", dash: "4 2", width: 1.5 },
    { key: "sd2n", label: "−2", dash: "4 2", width: 1.5 },
    { key: "sd1n", label: "−1", dash: "2 2", width: 1 },
    { key: "med",  label:  "0", width: 2 },
    { key: "sd1p", label: "+1", dash: "2 2", width: 1 },
    { key: "sd2p", label: "+2", dash: "4 2", width: 1.5 },
    { key: "sd3p", label: "+3", dash: "4 2", width: 1.5 },
  ];

  return (
    <div className="brutal overflow-hidden">
      {/* Header */}
      <div className={`px-3 py-2 ${childColor === "#1d4ed8" ? "bg-blue-100 border-b-2 border-blue-300" : "bg-pink-100 border-b-2 border-pink-300"}`}>
        <div className="font-display text-sm uppercase leading-tight">{title}</div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>

      <div className="p-2">
        {/* Y-axis label */}
        <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 pl-8">{yLabel}</div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 36, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" />

              {/* Colored zone backgrounds */}
              {zones.map((z) => (
                <ReferenceArea key={z.label} yAxisId={0}
                  y1={Math.min(...chartData.map((d) => d[z.y1Key] as number ?? 0).filter(Boolean))}
                  y2={Math.max(...chartData.map((d) => d[z.y2Key] as number ?? 0).filter(Boolean))}
                  fill={z.fill} fillOpacity={0.6} ifOverflow="hidden" />
              ))}

              <XAxis dataKey="age" type="number" domain={["dataMin", "dataMax"]}
                fontSize={9} stroke="#374151"
                label={{ value: "Age (months)", position: "insideBottom", offset: -12, fontSize: 9, fill: "#374151" }}
                tickFormatter={(v) => String(v)} />
              <YAxis domain={[yMin, yMax]} fontSize={9} stroke="#374151" width={36} />

              <Tooltip
                contentStyle={{ border: "2px solid #374151", borderRadius: 0, fontSize: 10, background: "#fff" }}
                formatter={(v: number, name: string) => {
                  if (name === "child") return [`${v} ${unit}`, "Child"];
                  return [`${v} ${unit}`, name];
                }}
                labelFormatter={(l) => `Age: ${l} months`}
              />

              {/* SD reference lines */}
              {sdLines.map(({ key, label, dash, width }) => (
                <Line key={key} type="monotone" dataKey={key}
                  stroke={SD_COLORS[key]} strokeWidth={width ?? 1}
                  strokeDasharray={dash} dot={false} name={label}
                  legendType="none" />
              ))}

              {/* Child data — prominent dots, sex-colored */}
              <Line type="monotone" dataKey="child"
                stroke={childColor} strokeWidth={2}
                dot={{ r: 6, fill: childColor, stroke: "#fff", strokeWidth: 2 }}
                activeDot={{ r: 8 }}
                connectNulls={false} name="child" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* SD legend */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1">
          {sdLines.map(({ key, label }) => (
            <span key={key} className="text-[9px] font-bold uppercase" style={{ color: SD_COLORS[key] }}>
              ─ {label} SD
            </span>
          ))}
          <span className="text-[9px] font-bold uppercase" style={{ color: childColor }}>
            ● Child
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Visit history table ────────────────────────────────────────────────────────

function VisitTable({
  visits,
  onEdit,
  onDelete,
}: {
  visits: GrowthVisit[];
  onEdit: (v: GrowthVisit) => void;
  onDelete: (id: string) => void;
}) {
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
            <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wider">Edit</th>
          </tr>
        </thead>
        <tbody>
          {[...visits].reverse().map((v, i) => (
            <tr key={v.id} className="border-b border-border" style={{ background: i % 2 === 0 ? "var(--background)" : "var(--muted)" }}>
              <td className="px-2 py-1.5">
                {new Date(v.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">{ageLabel(v.ageMonths)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{v.weight}</td>
              <td className={`px-2 py-1.5 text-right font-mono ${v.height < 30 ? "font-bold text-destructive" : ""}`}>
                {v.height}{v.height < 30 ? " ⚠" : ""}
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{v.muac ?? "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.waz) }}>{fmt(v.waz)}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.haz) }}>{fmt(v.haz)}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: zColor(v.whz) }}>{fmt(v.whz)}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-center gap-1">
                  <button
                    className="rounded p-1 hover:text-primary"
                    onClick={() => onEdit(v)}
                    title="Edit this visit"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="rounded p-1 hover:text-destructive"
                    onClick={() => onDelete(v.id)}
                    title="Delete this visit"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
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
  const [guardianName, setGuardianName] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState<"Male" | "Female">("Male");
  const [village, setVillage] = useState("");
  const [phone, setPhone] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const handleSave = () => {
    if (!name.trim()) { alert("Name is required."); return; }
    if (!dob) { alert("Date of birth is required."); return; }
    const p = store.addPatient({
      name: name.trim(),
      dob,
      sex,
      village,
      phone: phone || undefined,
      guardianName: guardianName.trim() || undefined,
    });
    onSave(p);
  };

  return (
    <div className="brutal mb-3 space-y-3 p-4">
      <div className="font-display text-sm uppercase tracking-widest">Track new patient</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Child's full name *</label>
          <input type="text" className="input-brutal w-full" placeholder="e.g. Rohit Kumar" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Son / Daughter of (guardian name)</label>
          <input type="text" className="input-brutal w-full" placeholder="e.g. Ramesh Kumar" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
          <p className="mt-0.5 text-[10px] text-muted-foreground">Helps distinguish children with the same name</p>
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
        <button type="button" className="btn-brutal flex-1" onClick={handleSave}>Save & add first visit →</button>
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

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const m = muac ? parseFloat(muac) : null;

    if (!weight || isNaN(w) || w <= 0) errs.weight = "Weight is required.";
    else if (w < 0.5 || w > 60) errs.weight = `Weight ${w} kg is outside the valid range (0.5–60 kg).`;

    if (!height || isNaN(h) || h <= 0) errs.height = "Height / Length is required.";
    else if (h < 30 || h > 130) errs.height = `Height ${h} cm is outside the valid range (30–130 cm).`
      + (h < 30 ? ` Did you enter MUAC in the height field?` : "");

    if (muac && m !== null && (m < 7 || m > 30)) errs.muac = `MUAC ${m} cm is outside range (7–30 cm).`;
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
        visitDate, ageMonths: ageAtVisit, weight: w, height: h, isLying, muac: m, edema,
        waz: zScores.waz, haz: zScores.haz, whz: zScores.whz,
        isSAM: zScores.isSAM, isMAM: zScores.isMAM, samCriteria: zScores.samCriteria,
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
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Weight (kg) *</label>
          <input type="number" step="0.1" min="0.5" max="60"
            className={`input-brutal w-full font-mono ${errors.weight ? "border-destructive" : ""}`}
            placeholder="e.g. 10.5" value={weight}
            onChange={(e) => setWeight(e.target.value)} />
          {errors.weight && <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.weight}</p>}
        </div>

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

        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">MUAC (cm) — optional</label>
          <input type="number" step="0.1" min="7" max="30"
            className={`input-brutal w-48 font-mono ${errors.muac ? "border-destructive" : ""}`}
            placeholder="e.g. 13.5" value={muac}
            onChange={(e) => setMuac(e.target.value)} />
          {errors.muac
            ? <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.muac}</p>
            : <p className="mt-0.5 text-[10px] text-muted-foreground">SAM threshold: &lt;11.5 cm</p>}
        </div>
      </div>

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
            ? "Under 24m: measure lying. If standing was used, +0.7 cm added before Z-score calc."
            : "24+m: measure standing. If lying was used, −0.7 cm applied before Z-score calc."}
        </p>
      </div>

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

// ── Edit Visit Modal ───────────────────────────────────────────────────────────

function EditVisitModal({ patient, visit, onSave, onCancel }: {
  patient: Patient;
  visit: GrowthVisit;
  onSave: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(visit.visitDate);
  const [weight, setWeight] = useState(String(visit.weight));
  const [height, setHeight] = useState(String(visit.height));
  const [muac, setMuac] = useState(visit.muac !== undefined ? String(visit.muac) : "");
  const [edema, setEdema] = useState(visit.edema);
  const [isLying, setIsLying] = useState(visit.isLying);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const ageAtVisit = useMemo(() => computeAgeInMonthsAt(patient.dob, visitDate), [patient.dob, visitDate]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const m = muac ? parseFloat(muac) : null;

    if (!weight || isNaN(w) || w <= 0) errs.weight = "Weight is required.";
    else if (w < 0.5 || w > 60) errs.weight = `Weight ${w} kg is outside valid range (0.5–60 kg).`;

    if (!height || isNaN(h) || h <= 0) errs.height = "Height / Length is required.";
    else if (h < 30 || h > 130) errs.height = `Height ${h} cm is outside valid range (30–130 cm).`;

    if (muac && m !== null && (m < 7 || m > 30)) errs.muac = `MUAC ${m} cm is outside range (7–30 cm).`;
    if (visitDate < patient.dob) errs.visitDate = "Visit date cannot be before date of birth.";
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

    store.deleteSubmission(visit.id);
    store.addSubmission({
      patientId: patient.id,
      formId: GROWTH_FORM_ID,
      formName: GROWTH_FORM_NAME,
      data: {
        visitDate, ageMonths: ageAtVisit, weight: w, height: h, isLying, muac: m, edema,
        waz: zScores.waz, haz: zScores.haz, whz: zScores.whz,
        isSAM: zScores.isSAM, isMAM: zScores.isMAM, samCriteria: zScores.samCriteria,
      },
    });
    onSave();
  }

  return (
    <div className="border-2 border-primary p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm uppercase tracking-widest text-primary">
          Edit visit — {new Date(visit.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </div>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Date of visit</label>
        <input type="date" className={`input-brutal w-full ${errors.visitDate ? "border-destructive" : ""}`}
          value={visitDate} min={patient.dob} max={today}
          onChange={(e) => setVisitDate(e.target.value)} />
        {errors.visitDate
          ? <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.visitDate}</p>
          : <p className="mt-0.5 text-[10px] text-muted-foreground">Age at this visit: {ageAtVisit} months</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Weight (kg) *</label>
          <input type="number" step="0.1" min="0.5" max="60"
            className={`input-brutal w-full font-mono ${errors.weight ? "border-destructive" : ""}`}
            value={weight} onChange={(e) => setWeight(e.target.value)} />
          {errors.weight && <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.weight}</p>}
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">
            {ageAtVisit < 24 ? "Length (cm) — lying *" : "Height (cm) — standing *"}
          </label>
          <input type="number" step="0.1" min="30" max="130"
            className={`input-brutal w-full font-mono ${errors.height ? "border-destructive" : ""}`}
            value={height} onChange={(e) => setHeight(e.target.value)} />
          {errors.height && <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.height}</p>}
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">MUAC (cm) — optional</label>
          <input type="number" step="0.1" min="7" max="30"
            className={`input-brutal w-48 font-mono ${errors.muac ? "border-destructive" : ""}`}
            value={muac} onChange={(e) => setMuac(e.target.value)} />
          {errors.muac && <p className="mt-0.5 text-[10px] font-bold text-destructive">{errors.muac}</p>}
        </div>
      </div>

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
      </div>

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
        <button type="button" className="btn-brutal flex-1" onClick={handleSave}>Save corrected visit</button>
      </div>
    </div>
  );
}

// ── Patient Share Panel ────────────────────────────────────────────────────────

function PatientSharePanel({
  patient,
  shareToken,
  onClose,
}: {
  patient: Patient;
  shareToken: string | undefined;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const link = shareToken ? `${window.location.origin}/pg/${shareToken}` : null;

  async function handleGenerate() {
    const tok = getToken();
    if (!tok) return;
    setWorking(true);
    // Step 1: flush all pending visit submissions to DB so the public link shows current data
    setMsg({ text: "Syncing visit data to server…", ok: true });
    try {
      await sync.drain();
    } catch {
      // drain logs internally; continue — partial sync is better than nothing
    }
    setMsg(null);
    const doGenerate = () =>
      fetch(`${API_BASE}/api/patients/${patient.id}/share-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      });
    try {
      let res = await doGenerate();
      if (res.status === 403) {
        await sync.pushPatient(patient);
        res = await doGenerate();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" }));
        setMsg({ text: body.detail ?? "Failed to generate link", ok: false });
        return;
      }
      const { token } = await res.json() as { token: string };
      store.updatePatient(patient.id, { shareToken: token });
      // Drain again to push the updated patient (with shareToken from server) back
      void sync.drain();
    } catch {
      setMsg({ text: "Network error — check your connection.", ok: false });
    } finally {
      setWorking(false);
    }
  }

  async function handleRevoke() {
    if (!window.confirm("Revoke this link? Anyone with it will lose access to this chart.")) return;
    const tok = getToken();
    if (!tok) return;
    setWorking(true);
    try {
      const res = await fetch(`${API_BASE}/api/patients/${patient.id}/share-token`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" }));
        setMsg({ text: body.detail ?? "Failed to revoke link", ok: false });
        return;
      }
      store.updatePatient(patient.id, { shareToken: undefined });
      setMsg(null);
    } catch {
      setMsg({ text: "Network error — check your connection.", ok: false });
    } finally {
      setWorking(false);
    }
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border-2 border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest">Share Growth Chart</div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Anyone with this link can view the patient's growth chart — read-only, no account needed.
      </p>
      {link ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              className="input-brutal flex-1 text-[10px] font-mono"
              onFocus={(e) => e.target.select()}
            />
            <button
              className="border-2 border-border px-2 py-1.5 text-[10px] font-bold uppercase hover:bg-primary/20"
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            className="w-full border-2 border-destructive px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-50"
            onClick={handleRevoke}
            disabled={working}
          >
            {working ? "Revoking…" : "Revoke link"}
          </button>
        </div>
      ) : (
        <button
          className="btn-brutal w-full text-xs disabled:opacity-50"
          onClick={handleGenerate}
          disabled={working}
        >
          {working ? "Generating…" : "Generate public link"}
        </button>
      )}
      {msg && (
        <p className={`text-[10px] font-bold ${msg.ok ? "text-[#16a34a]" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ── Quick Z-Score Calculator (Section B) ──────────────────────────────────────

function QuickCalculator() {
  const today = new Date().toISOString().slice(0, 10);
  const [sex, setSex] = useState<"Male" | "Female">("Male");
  const [dob, setDob] = useState("");
  const [manualAge, setManualAge] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [muac, setMuac] = useState("");

  const ageMonths = useMemo<number | null>(() => {
    if (dob) {
      const m = computeAgeInMonths(dob);
      return m >= 0 && m <= 228 ? m : null;
    }
    const m = parseInt(manualAge, 10);
    return !isNaN(m) && m >= 0 && m <= 228 ? m : null;
  }, [dob, manualAge]);

  const results = useMemo(() => {
    if (ageMonths === null) return null;
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const m = muac ? parseFloat(muac) : undefined;
    if (isNaN(w) || w <= 0 || isNaN(h) || h <= 0) return null;
    try {
      return computeVisitZScores(sex, ageMonths, w, h, m, false);
    } catch {
      return null;
    }
  }, [sex, ageMonths, weight, height, muac]);

  return (
    <div className="space-y-4">
      {/* Sex */}
      <div className="brutal grid grid-cols-2 overflow-hidden">
        {(["Male", "Female"] as const).map((s, i) => (
          <button key={s} onClick={() => setSex(s)}
            className={`py-3 text-sm font-bold uppercase tracking-wide ${sex === s ? "bg-primary" : "bg-card hover:bg-primary/30"} ${i === 0 ? "border-r-2 border-border" : ""}`}>
            {s === "Male" ? "Boys" : "Girls"}
          </button>
        ))}
      </div>

      {/* Age */}
      <div className="brutal p-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Age</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Date of birth</label>
            <input type="date" max={today} value={dob}
              onChange={(e) => { setDob(e.target.value); setManualAge(""); }}
              className="input-brutal w-full text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Or age in months</label>
            <input type="number" min="0" max="228" placeholder="e.g. 24"
              value={manualAge}
              onChange={(e) => { setManualAge(e.target.value); setDob(""); }}
              className="input-brutal w-full font-mono" />
          </div>
        </div>
        {ageMonths !== null && (
          <p className="text-[11px] font-bold text-muted-foreground">
            Age: {ageMonths} months ({Math.floor(ageMonths / 12)}y {ageMonths % 12}m)
            {ageMonths < 24 ? " — measure lying" : " — measure standing"}
          </p>
        )}
      </div>

      {/* Measurements */}
      <div className="brutal p-3 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Measurements</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">Weight (kg)</label>
            <input type="number" step="0.1" min="0.5" max="60" placeholder="e.g. 10.5"
              value={weight} onChange={(e) => setWeight(e.target.value)}
              className="input-brutal w-full font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">
              {ageMonths !== null && ageMonths < 24 ? "Length (cm) — lying" : "Height (cm)"}
            </label>
            <input type="number" step="0.1" min="30" max="200" placeholder="e.g. 75"
              value={height} onChange={(e) => setHeight(e.target.value)}
              className="input-brutal w-full font-mono" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">MUAC (cm) — optional</label>
            <input type="number" step="0.1" min="7" max="30" placeholder="e.g. 13.5"
              value={muac} onChange={(e) => setMuac(e.target.value)}
              className="input-brutal w-48 font-mono" />
            <p className="mt-0.5 text-[10px] text-muted-foreground">Mid-upper arm circumference · SAM threshold: &lt;11.5 cm</p>
          </div>
        </div>
      </div>

      {/* Live results */}
      {results ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { key: "WAZ", z: results.waz },
              { key: "HAZ", z: results.haz },
              { key: "WHZ", z: results.whz },
            ] as const).map(({ key, z }) => {
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
          {results.isSAM && (
            <div className="border-2 border-destructive bg-destructive/10 px-3 py-2 text-[11px] font-bold text-destructive">
              ⚠ SAM — Refer to NRC immediately · {results.samCriteria}
            </div>
          )}
          {!results.isSAM && results.isMAM && (
            <div className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
              ⚠ MAM — Monitor closely, nutritional support indicated
            </div>
          )}
        </div>
      ) : (
        <div className="brutal-flat p-5 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Enter age + weight + height above to see Z-scores instantly
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Reference: WHO 2006 standards (0–5 y). For screening only — not a clinical diagnosis.
      </p>
    </div>
  );
}

// ── MUAC Screening (Section C) ─────────────────────────────────────────────────

function MUACScreening() {
  const [muac, setMuac] = useState("");

  const result = useMemo(() => {
    const v = parseFloat(muac);
    if (isNaN(v) || v <= 0) return null;
    if (v < 11.5) return { label: "Severe Acute Malnutrition (SAM)", tone: "destructive" as const, detail: "Refer to NRC/NTC immediately. Confirm with WHZ or oedema check." };
    if (v < 12.5) return { label: "Moderate Acute Malnutrition (MAM)", tone: "warning" as const, detail: "Nutritional support indicated. Monitor closely and reassess in 2 weeks." };
    return { label: "Normal", tone: "success" as const, detail: "Continue routine growth monitoring." };
  }, [muac]);

  const toneClass = result?.tone === "success"
    ? "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a]"
    : result?.tone === "warning"
    ? "border-amber-400 bg-amber-50 text-amber-900"
    : "border-destructive bg-destructive/10 text-destructive";

  return (
    <div className="space-y-4">
      <div className="brutal p-4 space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest">
            Mid-upper arm circumference (cm)
          </label>
          <input
            type="number"
            step="0.1"
            min="5"
            max="30"
            placeholder="e.g. 13.5"
            value={muac}
            onChange={(e) => setMuac(e.target.value)}
            className="input-brutal w-full font-mono text-lg"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Measure left arm, midpoint between shoulder and elbow, relaxed
          </p>
        </div>

        {/* Colour-coded reference bands */}
        <div className="grid grid-cols-3 gap-1 text-center text-[9px] font-bold uppercase tracking-widest">
          <div className="border-2 border-destructive bg-destructive/10 py-1.5 text-destructive">&lt;11.5 cm<br />SAM</div>
          <div className="border-2 border-amber-400 bg-amber-50 py-1.5 text-amber-900">11.5–12.4<br />MAM</div>
          <div className="border-2 border-[#16a34a] bg-[#16a34a]/10 py-1.5 text-[#16a34a]">≥12.5 cm<br />Normal</div>
        </div>
      </div>

      {result ? (
        <div className={`brutal border-2 p-4 ${toneClass}`}>
          <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">Result — {muac} cm</div>
          <div className="mt-1 font-display text-2xl uppercase leading-tight">{result.label}</div>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider opacity-90">{result.detail}</div>
        </div>
      ) : (
        <div className="brutal-flat p-5 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Enter MUAC measurement above to classify
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Thresholds: WHO 2009 · applies to children 6–59 months · not for adults.
      </p>
    </div>
  );
}
