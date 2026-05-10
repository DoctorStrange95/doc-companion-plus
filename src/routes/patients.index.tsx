import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useStore, ageFromDob } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Plus, Search, MapPin } from "lucide-react";

export const Route = createFileRoute("/patients/")({ component: PatientsList });

function PatientsList() {
  const patients = useStore((s) => s.patients);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return patients;
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.village.toLowerCase().includes(t) ||
        p.tags.some((tag) => tag.toLowerCase().includes(t)),
    );
  }, [patients, q]);

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={`${patients.length} registered`}
        action={
          <Link to="/patients/new" className="btn-brutal inline-flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> New
          </Link>
        }
      />
      <PageShell>
        <div className="brutal mb-4 flex items-center gap-2 p-3">
          <Search className="h-4 w-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, village, or tag"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="brutal-flat p-8 text-center">
            <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {patients.length === 0 ? "No patients yet" : "No matches"}
            </p>
            <Link to="/patients/new" className="btn-brutal mt-4 inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Register patient
            </Link>
          </div>
        ) : (
          <ul className="brutal divide-y-2 divide-border">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link
                  to="/patients/$id"
                  params={{ id: p.id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-primary/30"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-border bg-primary font-display text-xl uppercase">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{p.name}</span>
                      <span className="chip">{p.sex.charAt(0)}</span>
                      <span className="text-xs font-bold uppercase tracking-wider">{ageFromDob(p.dob)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {p.village}
                      {p.tags.length > 0 && (
                        <span className="ml-2 flex gap-1">
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="chip chip-yellow">{t}</span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
