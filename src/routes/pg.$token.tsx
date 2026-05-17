/**
 * PUBLIC patient growth chart — /pg/:token
 * No authentication required. Read-only view shared by the patient's owner.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { API_BASE } from "@/lib/api";
import { PageHeader, PageShell } from "@/components/PageShell";
import { zColor } from "@/lib/who-lms";
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

export const Route = createFileRoute("/pg/$token")({ component: PublicPatientGrowth });

// ── Types ──────────────────────────────────────────────────────────────────────

interface PublicVisit {
  visitDate: string;
  ageMonths: number;
  weight: number;
  height: number;
  muac?: number;
  edema: boolean;
  waz: number | null;
  haz: number | null;
  whz: number | null;
  isSAM: boolean;
  isMAM: boolean;
  samCriteria: string;
}

interface PublicPatient {
  id: string;
  name: string;
  dob: string;
  sex: string;
  guardian_name?: string | null;
  village: string;
  visits: PublicVisit[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(z: number | null): string {
  if (z === null || isNaN(z as number)) return "—";
  return ((z as number) > 0 ? "+" : "") + (z as number).toFixed(2);
}

function ageLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}m`;
}

function classifyZ(key: string, z: number | null): string {
  if (z === null || isNaN(z as number)) return "—";
  const v = z as number;
  if (key === "WAZ") {
    if (v < -3) return "Sev. Underweight";
    if (v < -2) return "Underweight";
    if (v > 2) return "Overweight";
    return "Normal";
  }
  if (key === "HAZ") {
    if (v < -3) return "Sev. Stunted";
    if (v < -2) return "Stunted";
    if (v > 2) return "Tall";
    return "Normal";
  }
  if (v < -3) return "SAM";
  if (v < -2) return "MAM";
  if (v > 2) return "Overweight";
  return "Normal";
}

function computeAge(dob: string): string {
  const b = new Date(dob);
  const now = new Date();
  const months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}M`;
  if (m === 0) return `${y}Y`;
  return `${y}Y ${m}M`;
}

// ── Main component ─────────────────────────────────────────────────────────────

function PublicPatientGrowth() {
  const { token } = Route.useParams();
  const [data, setData] = useState<PublicPatient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/patients/public/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: "Not found" }));
          throw new Error(body.detail ?? "Failed to load");
        }
        return res.json() as Promise<PublicPatient>;
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  if (loading) {
    return (
      <>
        <PageHeader title="Growth Chart" variant="yellow" subtitle="Loading…" />
        <PageShell>
          <div className="py-16 text-center text-sm text-muted-foreground">Loading growth chart…</div>
        </PageShell>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Growth Chart" variant="yellow" subtitle="Not found" />
        <PageShell>
          <div className="brutal p-8 text-center">
            <div className="font-display text-2xl uppercase">Chart Not Found</div>
            <p className="mt-3 text-sm text-muted-foreground">
              {error ?? "This link may have been revoked by the owner."}
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  const visits = [...data.visits].sort(
    (a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime(),
  );
  const latest = visits.length > 0 ? visits[visits.length - 1] : null;

  return (
    <>
      <PageHeader
        title={data.name}
        variant="yellow"
        subtitle={`Growth chart · ${data.sex} · ${computeAge(data.dob)}${data.village ? ` · ${data.village}` : ""}`}
      />
      <PageShell>

        {/* Patient info */}
        <div className="brutal mb-4 p-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
            <div>
              <span className="font-bold uppercase tracking-widest text-muted-foreground">DOB </span>
              {data.dob}
            </div>
            <div>
              <span className="font-bold uppercase tracking-widest text-muted-foreground">Sex </span>
              {data.sex}
            </div>
            {data.guardian_name && (
              <div>
                <span className="font-bold uppercase tracking-widest text-muted-foreground">s/o · d/o </span>
                {data.guardian_name}
              </div>
            )}
            {data.village && (
              <div>
                <span className="font-bold uppercase tracking-widest text-muted-foreground">Village </span>
                {data.village}
              </div>
            )}
            <div>
              <span className="font-bold uppercase tracking-widest text-muted-foreground">Visits </span>
              {visits.length}
            </div>
          </div>
        </div>

        {visits.length === 0 ? (
          <div className="brutal-flat p-10 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            No growth visits recorded yet
          </div>
        ) : (
          <div className="space-y-4">

            {/* SAM/MAM alert */}
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

            {/* Latest Z-score cards */}
            {latest && (
              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Latest visit ({new Date(latest.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })})
                </div>
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
              </div>
            )}

            {/* Z-score trend chart */}
            {visits.length > 1 && <PublicTrendChart visits={visits} />}

            {/* Visit table */}
            <PublicVisitTable visits={visits} />
          </div>
        )}

        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          WHO 2006 standards (0–5 y) · ResearchMed · Read-only shared view
        </p>

      </PageShell>
    </>
  );
}

// ── Trend chart ────────────────────────────────────────────────────────────────

function PublicTrendChart({ visits }: { visits: PublicVisit[] }) {
  const data = useMemo(() =>
    visits.map((v) => ({
      age: v.ageMonths,
      WAZ: v.waz !== null && isFinite(v.waz) ? +v.waz.toFixed(2) : null,
      HAZ: v.haz !== null && isFinite(v.haz) ? +v.haz.toFixed(2) : null,
      WHZ: v.whz !== null && isFinite(v.whz) ? +v.whz.toFixed(2) : null,
    })),
    [visits],
  );

  return (
    <div className="brutal p-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest">Z-Score Trend (all visits)</div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="age" type="number" domain={["dataMin", "dataMax"]} fontSize={9} stroke="var(--foreground)"
              label={{ value: "months", position: "insideBottom", offset: -4, fontSize: 9 }} />
            <YAxis fontSize={9} stroke="var(--foreground)" />
            <Tooltip contentStyle={{ border: "2px solid var(--border)", borderRadius: 0, fontSize: 10 }}
              formatter={(v: number, name: string) => [`${v > 0 ? "+" : ""}${v}`, name]} />
            <Line type="monotone" dataKey="WAZ" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: "#3b82f6" }} connectNulls name="WAZ" />
            <Line type="monotone" dataKey="HAZ" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4, fill: "#8b5cf6" }} connectNulls name="HAZ" />
            <Line type="monotone" dataKey="WHZ" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: "#f59e0b" }} connectNulls name="WHZ" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-3 text-[9px] font-bold uppercase tracking-widest">
        <span style={{ color: "#3b82f6" }}>● WAZ</span>
        <span style={{ color: "#8b5cf6" }}>● HAZ</span>
        <span style={{ color: "#f59e0b" }}>● WHZ</span>
      </div>
    </div>
  );
}

// ── Visit table ────────────────────────────────────────────────────────────────

function PublicVisitTable({ visits }: { visits: PublicVisit[] }) {
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
            <tr key={`${v.visitDate}-${i}`} className="border-b border-border" style={{ background: i % 2 === 0 ? "var(--background)" : "var(--muted)" }}>
              <td className="px-2 py-1.5">
                {new Date(v.visitDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">{ageLabel(v.ageMonths)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{v.weight}</td>
              <td className="px-2 py-1.5 text-right font-mono">{v.height}</td>
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
