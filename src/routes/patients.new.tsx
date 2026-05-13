import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { store } from "@/lib/store";
import { useAuthGate } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";

export const Route = createFileRoute("/patients/new")({ component: NewPatient });

function NewPatient() {
  const nav = useNavigate();
  const { gate, requireAuth } = useAuthGate({ action: "register a patient" });
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
    requireAuth(() => {
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
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      nav({ to: "/patients/$id", params: { id: p.id } });
    });
  };

  return (
    <>
      {gate}
      <PageHeader title="Register Patient" back="/patients" variant="yellow" />
      <PageShell>
        <form onSubmit={submit} className="brutal space-y-4 p-5">
          <SectionTitle kicker="Required">Identity</SectionTitle>
          <Field label="Full name *">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-brutal" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth *">
              <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="input-brutal" />
            </Field>
            <Field label="Sex *">
              <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as never })} className="input-brutal">
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
            </Field>
          </div>
          <Field label="Village / locality *">
            <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} className="input-brutal" />
          </Field>
          <Field label="Phone (optional)">
            <input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-brutal" />
          </Field>
          <Field label="Tags (comma separated)" hint="e.g. ANC, TB, High-risk">
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="input-brutal" />
          </Field>

          {err && <p className="text-sm font-bold uppercase tracking-wider text-destructive">{err}</p>}

          <button type="submit" className="btn-brutal w-full">Register patient</button>
        </form>
      </PageShell>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{hint}</span>}
    </label>
  );
}
