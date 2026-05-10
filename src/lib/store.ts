/**
 * Hybrid offline-first store for CommunityMed Pro.
 *
 * - Cache lives in localStorage (works fully offline, identical to the previous
 *   implementation so existing routes keep working without changes).
 * - Every mutation is also queued for background sync to the FastAPI backend.
 * - When the network comes back AND the user is authenticated, the queue is
 *   drained automatically and a fresh snapshot is pulled from the server.
 */

import { useSyncExternalStore } from "react";
import { api, getToken, isOnline, ApiError } from "./api";

// ---------- Types ----------------------------------------------------------
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
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  visibleIf?: VisibleIf;
}

export interface FormDef {
  id: string;
  name: string;
  category: string;
  description?: string;
  fields: FormField[];
  createdAt: number;
  longitudinal?: boolean;
  ownerId?: string;
  shared?: boolean;
}

export interface Patient {
  id: string;
  name: string;
  dob: string;
  sex: "Male" | "Female" | "Other";
  village: string;
  phone?: string;
  tags: string[];
  status: "Active" | "Inactive";
  createdAt: number;
  ownerId?: string;
  shared?: boolean;
}

export interface Submission {
  id: string;
  patientId: string;
  formId: string;
  formName: string;
  data: Record<string, unknown>;
  createdAt: number;
  ownerId?: string;
}

type QueueOp =
  | { kind: "patient"; payload: Patient }
  | { kind: "form"; payload: FormDef }
  | { kind: "submission"; payload: Submission }
  | { kind: "patient.delete"; id: string }
  | { kind: "form.delete"; id: string };

interface State {
  patients: Patient[];
  forms: FormDef[];
  submissions: Submission[];
  worker: { name: string; village: string };
  queue: QueueOp[];
  lastSync: number | null;
  syncing: boolean;
  online: boolean;
}

const KEY = "communitymed_pro_v2";

// ---------- Seeds (only used if no cached data exists) ---------------------
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
      id: "form_skip_demo",
      name: "Skip Logic Demo",
      category: "Survey",
      description: "Conditional fields, multiselect, radio and GPS",
      createdAt: Date.now(),
      longitudinal: false,
      fields: [
        { id: "sd1", type: "radio", label: "Pregnant?", options: ["Yes", "No"], required: true },
        {
          id: "sd2",
          type: "number",
          label: "Gestational Age",
          unit: "weeks",
          min: 0,
          max: 45,
          visibleIf: { mode: "all", rules: [{ fieldId: "sd1", op: "eq", value: "Yes" }] },
        },
        {
          id: "sd3",
          type: "multiselect",
          label: "Symptoms",
          options: ["Fever", "Cough", "Headache", "Vomiting", "Diarrhea"],
        },
        {
          id: "sd4",
          type: "number",
          label: "Days with fever",
          unit: "days",
          min: 0,
          max: 30,
          visibleIf: { mode: "any", rules: [{ fieldId: "sd3", op: "contains", value: "Fever" }] },
        },
        { id: "sd5", type: "location", label: "Visit location" },
      ],
    },
    {
      id: "form_long_growth",
      name: "Growth Tracking (Longitudinal)",
      category: "Pediatric",
      description: "Repeatable monthly weight & MUAC tracking",
      createdAt: Date.now(),
      longitudinal: true,
      fields: [
        { id: "lg1", type: "number", label: "Weight", unit: "kg", required: true, min: 0.5, max: 60 },
        { id: "lg2", type: "number", label: "MUAC", unit: "cm", min: 5, max: 30 },
        { id: "lg3", type: "boolean", label: "Bilateral Pitting Edema" },
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
  queue: [],
  lastSync: null,
  syncing: false,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
});

// ---------- Persistence ----------------------------------------------------
let state: State = (() => {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...seed(), ...parsed, syncing: false };
    }
  } catch {
    /* ignore */
  }
  return seed();
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

const enqueue = (op: QueueOp) => {
  state = { ...state, queue: [...state.queue, op] };
};

// ---------- Server <-> local mappers --------------------------------------
interface SrvPatient {
  id: string;
  name: string;
  dob: string;
  sex: "Male" | "Female" | "Other";
  village: string;
  phone?: string | null;
  tags: string[];
  status: string;
  owner_id: string;
  created_at: string;
  shared?: boolean;
}
interface SrvForm {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  fields: FormField[];
  longitudinal: boolean;
  owner_id: string;
  created_at: string;
  shared?: boolean;
}
interface SrvSubmission {
  id: string;
  patient_id: string;
  form_id: string;
  form_name: string;
  data: Record<string, unknown>;
  owner_id: string;
  created_at: string;
}

const mapPatient = (s: SrvPatient): Patient => ({
  id: s.id,
  name: s.name,
  dob: s.dob,
  sex: s.sex,
  village: s.village,
  phone: s.phone ?? undefined,
  tags: s.tags ?? [],
  status: (s.status as Patient["status"]) ?? "Active",
  createdAt: new Date(s.created_at).getTime(),
  ownerId: s.owner_id,
  shared: !!s.shared,
});
const mapForm = (s: SrvForm): FormDef => ({
  id: s.id,
  name: s.name,
  category: s.category,
  description: s.description ?? undefined,
  fields: s.fields ?? [],
  longitudinal: s.longitudinal,
  createdAt: new Date(s.created_at).getTime(),
  ownerId: s.owner_id,
  shared: !!s.shared,
});
const mapSubmission = (s: SrvSubmission): Submission => ({
  id: s.id,
  patientId: s.patient_id,
  formId: s.form_id,
  formName: s.form_name,
  data: s.data ?? {},
  createdAt: new Date(s.created_at).getTime(),
  ownerId: s.owner_id,
});

// ---------- Mutations ------------------------------------------------------
export const store = {
  get: () => state,

  addPatient: (
    p: Omit<Patient, "id" | "createdAt" | "status" | "tags"> & { tags?: string[] },
  ) => {
    const patient: Patient = {
      ...p,
      tags: p.tags ?? [],
      status: "Active",
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    state = { ...state, patients: [patient, ...state.patients] };
    enqueue({ kind: "patient", payload: patient });
    persist();
    void drain();
    return patient;
  },

  updatePatient: (id: string, patch: Partial<Patient>) => {
    state = {
      ...state,
      patients: state.patients.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    };
    const updated = state.patients.find((p) => p.id === id);
    if (updated) enqueue({ kind: "patient", payload: updated });
    persist();
    void drain();
  },

  deletePatient: (id: string) => {
    state = {
      ...state,
      patients: state.patients.filter((p) => p.id !== id),
      submissions: state.submissions.filter((s) => s.patientId !== id),
    };
    enqueue({ kind: "patient.delete", id });
    persist();
    void drain();
  },

  addForm: (f: Omit<FormDef, "id" | "createdAt">) => {
    const form: FormDef = {
      ...f,
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    state = { ...state, forms: [form, ...state.forms] };
    enqueue({ kind: "form", payload: form });
    persist();
    void drain();
    return form;
  },

  deleteForm: (id: string) => {
    state = { ...state, forms: state.forms.filter((f) => f.id !== id) };
    enqueue({ kind: "form.delete", id });
    persist();
    void drain();
  },

  addSubmission: (s: Omit<Submission, "id" | "createdAt">) => {
    const sub: Submission = {
      ...s,
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    state = { ...state, submissions: [sub, ...state.submissions] };
    enqueue({ kind: "submission", payload: sub });
    persist();
    void drain();
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

  // ---- Cache lifecycle (for auth) ----
  hydrateFromCache: () => {
    persist();
  },

  clearForLogout: () => {
    state = {
      ...seed(),
      patients: [],
      forms: [],
      submissions: [],
      queue: [],
    };
    persist();
  },
};

// ---------- Sync engine ----------------------------------------------------
async function pullSnapshot() {
  if (!getToken()) return;
  try {
    const data = await api<{
      patients: SrvPatient[];
      forms: SrvForm[];
      submissions: SrvSubmission[];
    }>("/api/sync/pull");
    const serverPatients = data.patients.map(mapPatient);
    const serverForms = data.forms.map(mapForm);
    const serverSubs = data.submissions.map(mapSubmission);

    // Merge: server is source of truth for visible records, but keep local-only
    // (queued, not-yet-synced) rows by union with current cache.
    const sIds = new Set(serverPatients.map((p) => p.id));
    const localOnlyPatients = state.patients.filter((p) => !sIds.has(p.id) && !p.ownerId);
    const fIds = new Set(serverForms.map((f) => f.id));
    const localOnlyForms = state.forms.filter((f) => !fIds.has(f.id) && !f.ownerId);
    const subIds = new Set(serverSubs.map((s) => s.id));
    const localOnlySubs = state.submissions.filter(
      (s) => !subIds.has(s.id) && !s.ownerId,
    );

    state = {
      ...state,
      patients: [...localOnlyPatients, ...serverPatients],
      forms: [...localOnlyForms, ...serverForms],
      submissions: [...localOnlySubs, ...serverSubs],
      lastSync: Date.now(),
    };
    persist();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // Auth bad — caller will handle (logout)
      throw e;
    }
    // network / 5xx — just stay offline silently
  }
}

async function drain() {
  if (!isOnline() || !getToken() || state.syncing || state.queue.length === 0) {
    return;
  }
  state = { ...state, syncing: true };
  persist();
  const batch = state.queue;
  try {
    // Push upserts in one bulk call
    const patients = batch.flatMap((o) => (o.kind === "patient" ? [o.payload] : []));
    const forms = batch.flatMap((o) => (o.kind === "form" ? [o.payload] : []));
    const submissions = batch.flatMap((o) =>
      o.kind === "submission" ? [o.payload] : [],
    );
    if (patients.length || forms.length || submissions.length) {
      await api("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          patients: patients.map(({ ownerId: _o, shared: _s, createdAt: _c, ...rest }) => rest),
          forms: forms.map(({ ownerId: _o, shared: _s, createdAt: _c, ...rest }) => rest),
          submissions: submissions.map(({ ownerId: _o, createdAt: _c, ...rest }) => ({
            id: rest.id,
            patient_id: rest.patientId,
            form_id: rest.formId,
            form_name: rest.formName,
            data: rest.data,
          })),
        }),
      });
    }

    // Process deletes one by one
    for (const op of batch) {
      if (op.kind === "patient.delete") {
        try {
          await api(`/api/patients/${op.id}`, { method: "DELETE" });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
      if (op.kind === "form.delete") {
        try {
          await api(`/api/forms/${op.id}`, { method: "DELETE" });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
    }

    // Clear queue, refresh from server
    state = { ...state, queue: [], syncing: false };
    persist();
    await pullSnapshot();
  } catch (e) {
    state = { ...state, syncing: false };
    persist();
    if (e instanceof ApiError && e.status === 401) {
      throw e;
    }
    // Otherwise leave queue intact for next attempt
  }
}

export const sync = {
  drain,
  pull: pullSnapshot,
};

// ---------- Online listener -----------------------------------------------
if (typeof window !== "undefined") {
  const onOnline = () => {
    state = { ...state, online: true };
    persist();
    void drain();
  };
  const onOffline = () => {
    state = { ...state, online: false };
    persist();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // Initial drain attempt on app boot
  setTimeout(() => {
    void drain();
  }, 1500);
}

// ---------- Helpers --------------------------------------------------------
export const ageFromDob = (dob: string) => {
  if (!dob) return "";
  const d = new Date(dob);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} y`;
};
