import { useMemo, useState } from "react";
import { useStore, store, type Patient } from "@/lib/store";
import { Search, UserPlus, X, Check } from "lucide-react";

interface Props {
  value: string; // selected patient id
  onChange: (id: string) => void;
}

export function PatientPicker({ value, onChange }: Props) {
  const patients = useStore((s) => s.patients);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    dob: "",
    sex: "Female" as Patient["sex"],
    village: "",
    phone: "",
  });
  const [draftErr, setDraftErr] = useState("");

  const selected = patients.find((p) => p.id === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? patients.filter((p) => {
          const hay = `${p.name} ${p.village} ${p.phone ?? ""} ${p.tags.join(" ")}`.toLowerCase();
          return hay.includes(q);
        })
      : patients;
    return list.slice(0, 8);
  }, [patients, query]);

  const saveNewPatient = () => {
    if (!draft.name.trim() || !draft.dob || !draft.village.trim()) {
      setDraftErr("Name, date of birth, and village are required.");
      return;
    }
    const p = store.addPatient({
      name: draft.name.trim(),
      dob: draft.dob,
      sex: draft.sex,
      village: draft.village.trim(),
      phone: draft.phone.trim() || undefined,
      tags: [],
    });
    onChange(p.id);
    setShowAdd(false);
    setQuery("");
    setDraft({ name: "", dob: "", sex: "Female", village: "", phone: "" });
    setDraftErr("");
  };

  return (
    <div className="space-y-2" data-testid="patient-picker">
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">
        Patient
      </label>

      {selected ? (
        <div className="flex items-center justify-between gap-2 border-2 border-border bg-primary p-3">
          <div className="min-w-0">
            <div className="truncate font-display text-base uppercase">
              {selected.name}
            </div>
            <div className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {selected.village}
              {selected.phone ? ` · ${selected.phone}` : ""}
            </div>
          </div>
          <button
            type="button"
            data-testid="patient-clear"
            onClick={() => onChange("")}
            className="border-2 border-border bg-card p-1.5 hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Change patient"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, village, phone…"
              data-testid="patient-search-input"
              className="input-brutal pl-8"
            />
          </div>

          {patients.length === 0 ? (
            <p
              data-testid="patient-empty-state"
              className="border-2 border-dashed border-border p-3 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
            >
              No patients yet — add one below.
            </p>
          ) : matches.length === 0 ? (
            <p className="border-2 border-dashed border-border p-3 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              No matches for "{query}"
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-testid={`patient-option-${p.id}`}
                    onClick={() => onChange(p.id)}
                    className="flex w-full items-center justify-between gap-2 border-2 border-border bg-card px-3 py-2 text-left hover:bg-primary/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{p.name}</div>
                      <div className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {p.village}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </div>
                    </div>
                    {p.tags.length > 0 && (
                      <div className="flex shrink-0 gap-1">
                        {p.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="border-2 border-border bg-muted px-1.5 text-[9px] font-bold uppercase tracking-wider"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!showAdd ? (
            <button
              type="button"
              data-testid="patient-add-toggle"
              onClick={() => {
                setShowAdd(true);
                if (query && !draft.name) setDraft((d) => ({ ...d, name: query }));
              }}
              className="flex w-full items-center justify-center gap-2 border-2 border-border bg-secondary py-2.5 text-xs font-bold uppercase tracking-wider text-secondary-foreground hover:bg-secondary/80"
            >
              <UserPlus className="h-4 w-4" /> Add new patient
            </button>
          ) : (
            <div
              data-testid="patient-add-form"
              className="space-y-2 border-2 border-border bg-card p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-widest">
                  New patient
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setDraftErr("");
                  }}
                  className="border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Full name *"
                data-testid="quick-name"
                className="input-brutal text-xs"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={draft.dob}
                  onChange={(e) => setDraft({ ...draft, dob: e.target.value })}
                  data-testid="quick-dob"
                  className="input-brutal text-xs"
                />
                <select
                  value={draft.sex}
                  onChange={(e) =>
                    setDraft({ ...draft, sex: e.target.value as Patient["sex"] })
                  }
                  data-testid="quick-sex"
                  className="input-brutal text-xs"
                >
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </select>
              </div>
              <input
                value={draft.village}
                onChange={(e) => setDraft({ ...draft, village: e.target.value })}
                placeholder="Village / locality *"
                data-testid="quick-village"
                className="input-brutal text-xs"
              />
              <input
                inputMode="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="Phone (optional)"
                data-testid="quick-phone"
                className="input-brutal text-xs"
              />
              {draftErr && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                  {draftErr}
                </p>
              )}
              <button
                type="button"
                onClick={saveNewPatient}
                data-testid="quick-save"
                className="btn-brutal flex w-full items-center justify-center gap-1.5 text-xs"
              >
                <Check className="h-4 w-4" /> Save & select
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
