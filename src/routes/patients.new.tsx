import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { store } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";

export const Route = createFileRoute("/patients/new")({ component: NewPatient });

function NewPatient() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "",
    dob: "",
    sex: "Female" as "Male" | "Female" | "Other",
    village: "",
    phone: "",
    tags: "",
  });
  const [err, setErr] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.dob || !form.village.trim()) {
      setErr("Name, date of birth, and village are required.");
      return;
    }
    const p = store.addPatient({
      name: form.name.trim(),
      dob: form.dob,
      sex: form.sex,
      village: form.village.trim(),
      phone: form.phone.trim() || undefined,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    nav({ to: "/patients/$id", params: { id: p.id } });
  };

  return (
    <>
      <PageHeader title="Register patient" back="/patients" />
      <PageShell>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
          <Field label="Full name" required>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth" required>
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Sex" required>
              <select
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value as never })}
                className="input"
              >
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
            </Field>
          </div>
          <Field label="Village / locality" required>
            <input
              value={form.village}
              onChange={(e) => setForm({ ...form, village: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Phone (optional)">
            <input
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Tags (comma separated)" hint="e.g. ANC, TB, High-risk">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="input"
            />
          </Field>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <button
            type="submit"
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Register patient
          </button>
        </form>
        <style>{`
          .input { width:100%; border-radius:0.625rem; border:1px solid var(--border); background:var(--background); padding:0.5rem 0.75rem; font-size:0.875rem; outline:none; }
          .input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 20%, transparent); }
        `}</style>
      </PageShell>
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
