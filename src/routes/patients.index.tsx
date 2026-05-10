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
          <Link
            to="/patients/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New
          </Link>
        }
      />
      <PageShell>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, village, or tag"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {patients.length === 0 ? "No patients yet." : "No matches."}
            </p>
            <Link
              to="/patients/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Register patient
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link
                  to="/patients/$id"
                  params={{ id: p.id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {p.sex.charAt(0)}
                      </span>
                      <span className="text-xs text-muted-foreground">{ageFromDob(p.dob)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {p.village}
                      {p.tags.length > 0 && (
                        <span className="ml-2 flex gap-1">
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                              {t}
                            </span>
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
