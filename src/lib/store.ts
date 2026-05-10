import { useSyncExternalStore } from "react";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "multiselect"
  | "textarea"
  | "boolean"
  | "location";

export type SkipOp = "eq" | "neq" | "gt" | "lt" | "contains";

export interface SkipRule {
  fieldId: string;
  op: SkipOp;
  value: string | number;
}

export interface VisibleIf {
  mode: "all" | "any";
  rules: SkipRule[];
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[]; // for select / radio / multiselect
  unit?: string; // e.g. kg, cm
  min?: number;
  max?: number;
  visibleIf?: VisibleIf;
}

export interface FormDef {
  id: string;
  name: string;
  category: string; // ANC, Child, General, etc.
  description?: string;
  fields: FormField[];
  createdAt: number;
  longitudinal?: boolean; // form is repeatable / tracked over time
}

export interface Patient {
  id: string;
  name: string;
  dob: string; // YYYY-MM-DD
  sex: "Male" | "Female" | "Other";
  village: string;
  phone?: string;
  tags: string[];
  status: "Active" | "Inactive";
  createdAt: number;
}

export interface Submission {
  id: string;
  patientId: string;
  formId: string;
  formName: string;
  data: Record<string, unknown>;
  createdAt: number;
}

interface State {
  patients: Patient[];
  forms: FormDef[];
  submissions: Submission[];
  worker: { name: string; village: string };
}

const KEY = "communitymed_pro_v1";

const seed = (): State => ({
  patients: [],
  forms: [
    {
      id: "form_anc",
      name: "ANC Visit",
      category: "Maternal",
      description: "Antenatal care checkup",
      createdAt: Date.now(),
      fields: [
        { id: "f1", type: "number", label: "Gestational Age", unit: "weeks", required: true, min: 0, max: 45 },
        { id: "f2", type: "number", label: "Weight", unit: "kg", required: true, min: 20, max: 200 },
        { id: "f3", type: "number", label: "Systolic BP", unit: "mmHg", min: 50, max: 250 },
        { id: "f4", type: "number", label: "Diastolic BP", unit: "mmHg", min: 30, max: 150 },
        { id: "f5", type: "number", label: "Hemoglobin", unit: "g/dL", min: 2, max: 20 },
        { id: "f6", type: "select", label: "Edema", options: ["None", "Mild", "Moderate", "Severe"] },
        { id: "f7", type: "textarea", label: "Notes" },
      ],
    },
    {
      id: "form_child",
      name: "Child Growth Monitoring",
      category: "Pediatric",
      description: "Weight, height, MUAC tracking",
      createdAt: Date.now(),
      fields: [
        { id: "c1", type: "number", label: "Weight", unit: "kg", required: true, min: 0.5, max: 60 },
        { id: "c2", type: "number", label: "Height", unit: "cm", required: true, min: 30, max: 200 },
        { id: "c3", type: "number", label: "MUAC", unit: "cm", min: 5, max: 30 },
        { id: "c4", type: "boolean", label: "Bilateral Pitting Edema" },
        { id: "c5", type: "select", label: "Immunizations Up-to-Date", options: ["Yes", "No", "Partial"] },
        { id: "c6", type: "textarea", label: "Observations" },
      ],
    },
    {
      id: "form_gen",
      name: "General Consultation",
      category: "General",
      description: "Symptom-based visit",
      createdAt: Date.now(),
      fields: [
        { id: "g1", type: "text", label: "Chief Complaint", required: true },
        { id: "g2", type: "number", label: "Temperature", unit: "°C", min: 30, max: 45 },
        { id: "g3", type: "number", label: "Pulse", unit: "bpm", min: 30, max: 220 },
        { id: "g4", type: "select", label: "Severity", options: ["Mild", "Moderate", "Severe"] },
        { id: "g5", type: "textarea", label: "Plan / Referral" },
      ],
    },
  ],
  submissions: [],
  worker: { name: "Health Worker", village: "Demo Village" },
});

let state: State = (() => {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const s = seed();
  return s;
})();

const listeners = new Set<() => void>();

const persist = () => {
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useStore = <T,>(selector: (s: State) => T): T =>
  useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );

export const store = {
  get: () => state,
  addPatient: (p: Omit<Patient, "id" | "createdAt" | "status" | "tags"> & { tags?: string[] }) => {
    const patient: Patient = {
      ...p,
      tags: p.tags ?? [],
      status: "Active",
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    state = { ...state, patients: [patient, ...state.patients] };
    persist();
    return patient;
  },
  updatePatient: (id: string, patch: Partial<Patient>) => {
    state = { ...state, patients: state.patients.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    persist();
  },
  deletePatient: (id: string) => {
    state = {
      ...state,
      patients: state.patients.filter((p) => p.id !== id),
      submissions: state.submissions.filter((s) => s.patientId !== id),
    };
    persist();
  },
  addForm: (f: Omit<FormDef, "id" | "createdAt">) => {
    const form: FormDef = { ...f, id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() };
    state = { ...state, forms: [form, ...state.forms] };
    persist();
    return form;
  },
  deleteForm: (id: string) => {
    state = { ...state, forms: state.forms.filter((f) => f.id !== id) };
    persist();
  },
  addSubmission: (s: Omit<Submission, "id" | "createdAt">) => {
    const sub: Submission = { ...s, id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() };
    state = { ...state, submissions: [sub, ...state.submissions] };
    persist();
    return sub;
  },
  setWorker: (w: { name: string; village: string }) => {
    state = { ...state, worker: w };
    persist();
  },
  reset: () => {
    state = seed();
    persist();
  },
};

export const ageFromDob = (dob: string) => {
  if (!dob) return "";
  const d = new Date(dob);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} y`;
};
