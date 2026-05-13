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
  // Legacy types (kept for backward compat with saved data)
  | "text"
  | "select"
  | "radio"
  | "multiselect"
  | "textarea"
  | "boolean"
  // Core types (new names)
  | "short_text"
  | "long_text"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "select_one"
  | "select_many"
  | "yes_no"
  // Advanced
  | "slider"
  | "rating"
  | "calculated"
  | "matrix"
  // Clinical
  | "measurement"
  | "location"
  | "photo"
  | "file_upload"
  // Layout
  | "section_header"
  | "page_break";

export type SkipOp = "eq" | "neq" | "gt" | "lt" | "contains" | "is_answered";

export interface SkipRule {
  fieldId: string;
  op: SkipOp;
  value: string | number;
}

export interface VisibleIf {
  mode: "all" | "any";
  rules: SkipRule[];
}

export type ConditionalOperator =
  | "equals" | "not_equals"
  | "greater_than" | "less_than"
  | "greater_than_or_equal" | "less_than_or_equal"
  | "contains" | "not_contains"
  | "is_answered" | "is_not_answered"
  | "is_one_of" | "is_not_one_of";

export interface ConditionalRule {
  id: string;
  fieldId: string;
  operator: ConditionalOperator;
  value: unknown;
}

export interface ConditionalLogic {
  combinator: "AND" | "OR";
  rules: ConditionalRule[];
}

export function ruleId(): string {
  return `r_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeShowIf(showIf: unknown): ConditionalLogic | undefined {
  if (!showIf) return undefined;
  const obj = showIf as Record<string, unknown>;
  if ("combinator" in obj && Array.isArray(obj.rules)) return obj as unknown as ConditionalLogic;
  if ("fieldId" in obj) {
    return {
      combinator: "AND",
      rules: [{ id: "legacy_0", fieldId: obj.fieldId as string, operator: (obj.operator as ConditionalOperator) ?? "equals", value: obj.value }],
    };
  }
  return undefined;
}

export function evaluateRule(rule: ConditionalRule, state: Record<string, unknown>): boolean {
  const v = state[rule.fieldId];
  const rv = rule.value;
  const answered = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  switch (rule.operator) {
    case "equals":
      if (Array.isArray(v)) return v.map(String).includes(String(rv));
      return String(v ?? "") === String(rv ?? "");
    case "not_equals":
      if (Array.isArray(v)) return !v.map(String).includes(String(rv));
      return String(v ?? "") !== String(rv ?? "");
    case "greater_than": return Number(v) > Number(rv);
    case "less_than": return Number(v) < Number(rv);
    case "greater_than_or_equal": return Number(v) >= Number(rv);
    case "less_than_or_equal": return Number(v) <= Number(rv);
    case "contains":
      if (Array.isArray(v)) return v.map(String).some((x) => x.toLowerCase().includes(String(rv).toLowerCase()));
      return String(v ?? "").toLowerCase().includes(String(rv).toLowerCase());
    case "not_contains":
      if (Array.isArray(v)) return !v.map(String).some((x) => x.toLowerCase().includes(String(rv).toLowerCase()));
      return !String(v ?? "").toLowerCase().includes(String(rv).toLowerCase());
    case "is_answered": return answered;
    case "is_not_answered": return !answered;
    case "is_one_of": return Array.isArray(rv) && (rv as unknown[]).some((opt) => String(opt) === String(v));
    case "is_not_one_of": return !Array.isArray(rv) || !(rv as unknown[]).some((opt) => String(opt) === String(v));
    default: return true;
  }
}

export function evaluateConditions(showIf: unknown, state: Record<string, unknown>): boolean {
  const logic = normalizeShowIf(showIf);
  if (!logic || logic.rules.length === 0) return true;
  const results = logic.rules.map((r) => evaluateRule(r, state));
  return logic.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
}

export type ChartType = "histogram" | "line" | "bar" | "pie" | "donut" | "none" | "auto";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  // Legacy properties
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  visibleIf?: VisibleIf;
  // New properties (spec)
  variableName?: string;
  hint?: string;
  defaultValue?: unknown;
  analyticsChart?: ChartType;
  normalRange?: { min: number; max: number };
  showIf?: ConditionalLogic;
  // Number / Measurement
  decimalPlaces?: number;
  // Slider
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  leftLabel?: string;
  rightLabel?: string;
  showValue?: boolean;
  // Rating
  maxRating?: number;
  ratingType?: "stars" | "numbers";
  // Calculated
  formula?: string;
  referencedFields?: string[];
  // Matrix
  matrixRows?: string[];
  matrixColumns?: string[];
  // Select (new spec)
  optionObjects?: { label: string; value: string }[];
  displayAs?: "radio" | "dropdown";
  includeOther?: boolean;
  // Measurement clinical preset
  measurementType?: "BP" | "temperature" | "SpO2" | "BSL" | "MUAC" | "weight" | "height" | "custom";
  // File upload
  acceptTypes?: string; // MIME or extension filter, e.g. "*", "image/*", ".pdf,.docx"
  maxSizeMB?: number;   // max file size in MB (default 5)
}

export type FormRole = "standalone" | "parent" | "child";

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
  status?: "draft" | "active" | "closed";
  shareToken?: string;
  analyticsToken?: string;
  isPublic?: boolean;
  allowedFillerEmails?: string[];
  responseCount?: number;
  requireRespondentInfo?: boolean;
  requireRespondentId?: boolean;
  // Parent-child longitudinal structure
  formRole?: FormRole;
  subjectIdentifierFieldId?: string; // parent: field whose value identifies the subject
  parentFormId?: string;             // child: linked parent form ID
  parentLinkFieldId?: string;        // child: field where respondent types the parent subject ID
}

export interface Patient {
  id: string;
  name: string;
  dob: string;
  sex: "Male" | "Female" | "Other";
  village: string;
  phone?: string;
  guardianName?: string;
  shareToken?: string;
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
function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of arr) seen.set(item.id, item);
  return [...seen.values()];
}

let state: State = (() => {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const loaded: State = { ...seed(), ...parsed, syncing: false };
      // Deduplicate on load to self-heal any accumulated duplicates in localStorage
      loaded.forms = dedupeById(loaded.forms);
      loaded.patients = dedupeById(loaded.patients);
      loaded.submissions = dedupeById(loaded.submissions);
      return loaded;
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
  guardian_name?: string | null;
  share_token?: string | null;
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
  share_token?: string | null;
  analytics_token?: string | null;
  is_public?: boolean | null;
  allowed_filler_emails?: string[] | null;
  status?: string | null;
  form_role?: string | null;
  parent_form_id?: string | null;
  subject_identifier_field_id?: string | null;
  parent_link_field_id?: string | null;
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
  guardianName: s.guardian_name ?? undefined,
  shareToken: s.share_token ?? undefined,
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
  shareToken: s.share_token ?? undefined,
  analyticsToken: s.analytics_token ?? undefined,
  isPublic: s.is_public ?? true,
  allowedFillerEmails: s.allowed_filler_emails ?? [],
  status: (s.status as FormDef["status"]) ?? "active",
  formRole: (s.form_role as FormRole) ?? "standalone",
  parentFormId: s.parent_form_id ?? undefined,
  subjectIdentifierFieldId: s.subject_identifier_field_id ?? undefined,
  parentLinkFieldId: s.parent_link_field_id ?? undefined,
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
      status: f.status ?? "active",
      shareToken: f.shareToken,
      analyticsToken: f.analyticsToken,
      responseCount: 0,
    };
    state = { ...state, forms: [form, ...state.forms] };
    enqueue({ kind: "form", payload: form });
    persist();
    void drain();
    return form;
  },

  updateForm: (id: string, patch: Partial<FormDef>) => {
    state = {
      ...state,
      forms: state.forms.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    };
    const updated = state.forms.find((f) => f.id === id);
    if (updated) enqueue({ kind: "form", payload: updated });
    persist();
    void drain();
  },

  duplicateForm: (id: string): FormDef => {
    const orig = state.forms.find((f) => f.id === id);
    if (!orig) throw new Error("Form not found");
    const copy: FormDef = {
      ...orig,
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `Copy of ${orig.name}`,
      createdAt: Date.now(),
      status: "draft",
      shareToken: undefined,
      analyticsToken: undefined,
      responseCount: 0,
      ownerId: undefined,
    };
    state = { ...state, forms: [copy, ...state.forms] };
    enqueue({ kind: "form", payload: copy });
    persist();
    void drain();
    return copy;
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

  deleteSubmission: (id: string) => {
    state = { ...state, submissions: state.submissions.filter((s) => s.id !== id) };
    persist();
    if (getToken() && isOnline()) {
      api(`/api/submissions/${id}`, { method: "DELETE" }).catch(() => {});
    }
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

    // Build canonical Maps of pending items directly from the queue payload.
    // Using the queue as the source (not state.forms/patients) guarantees exactly
    // one entry per ID and eliminates any duplicates that accumulated in local state.
    const pendingFormMap = new Map<string, FormDef>();
    const pendingPatientMap = new Map<string, Patient>();
    for (const op of state.queue) {
      if (op.kind === "form") pendingFormMap.set(op.payload.id, op.payload);
      if (op.kind === "patient") pendingPatientMap.set(op.payload.id, op.payload);
    }

    const fIds = new Set(serverForms.map((f) => f.id));
    const sIds = new Set(serverPatients.map((p) => p.id));
    const subIds = new Set(serverSubs.map((s) => s.id));

    // Local-only: not on server, no ownerId, not in pending queue.
    // Use a Map to deduplicate by ID in case local state has stale duplicates.
    const localOnlyFormMap = new Map(
      state.forms
        .filter((f) => !fIds.has(f.id) && !f.ownerId && !pendingFormMap.has(f.id))
        .map((f) => [f.id, f]),
    );
    const localOnlyPatientMap = new Map(
      state.patients
        .filter((p) => !sIds.has(p.id) && !p.ownerId && !pendingPatientMap.has(p.id))
        .map((p) => [p.id, p]),
    );
    const localOnlySubs = state.submissions.filter(
      (s) => !subIds.has(s.id) && !s.ownerId,
    );

    // Server data for items that have no pending local update
    const safeServerForms = serverForms.filter((f) => !pendingFormMap.has(f.id));
    const safeServerPatients = serverPatients.filter((p) => !pendingPatientMap.has(p.id));

    state = {
      ...state,
      patients: [...localOnlyPatientMap.values(), ...safeServerPatients, ...pendingPatientMap.values()],
      forms: [...localOnlyFormMap.values(), ...safeServerForms, ...pendingFormMap.values()],
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
          patients: patients.map(({ ownerId: _o, shared: _s, createdAt: _c, guardianName, shareToken: _st, ...rest }) => ({
            ...rest,
            guardian_name: guardianName ?? null,
          })),
          forms: forms.map(({
            ownerId: _o, shared: _s, createdAt: _c,
            shareToken, analyticsToken, isPublic, allowedFillerEmails,
            formRole, parentFormId, subjectIdentifierFieldId, parentLinkFieldId,
            responseCount: _rc,
            requireRespondentInfo: _rri, requireRespondentId: _rrid,
            ...rest
          }) => ({
            ...rest,
            share_token: shareToken ?? null,
            analytics_token: analyticsToken ?? null,
            is_public: isPublic ?? true,
            allowed_filler_emails: allowedFillerEmails ?? [],
            form_role: formRole ?? "standalone",
            parent_form_id: parentFormId ?? null,
            subject_identifier_field_id: subjectIdentifierFieldId ?? null,
            parent_link_field_id: parentLinkFieldId ?? null,
          })),
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

    // Remove only the ops we just sent; preserve any items enqueued during drain
    state = { ...state, queue: state.queue.filter((op) => !batch.includes(op)), syncing: false };
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

function serializeFormForApi(f: FormDef) {
  const {
    ownerId: _o, shared: _s, createdAt: _c,
    shareToken, analyticsToken, isPublic, allowedFillerEmails,
    formRole, parentFormId, subjectIdentifierFieldId, parentLinkFieldId,
    responseCount: _rc,
    requireRespondentInfo: _rri, requireRespondentId: _rrid,
    ...rest
  } = f;
  return {
    ...rest,
    share_token: shareToken ?? null,
    analytics_token: analyticsToken ?? null,
    is_public: isPublic ?? true,
    allowed_filler_emails: allowedFillerEmails ?? [],
    form_role: formRole ?? "standalone",
    parent_form_id: parentFormId ?? null,
    subject_identifier_field_id: subjectIdentifierFieldId ?? null,
    parent_link_field_id: parentLinkFieldId ?? null,
  };
}

export const sync = {
  drain,
  pull: pullSnapshot,
  pushForm: async (f: FormDef) => {
    const token = getToken();
    if (!token) return;
    await api("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ patients: [], forms: [serializeFormForApi(f)], submissions: [] }),
    });
  },
  pushPatient: async (p: Patient) => {
    const token = getToken();
    if (!token) return;
    const { ownerId: _o, shared: _s, createdAt: _c, guardianName, shareToken: _st, ...rest } = p;
    await api("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        patients: [{ ...rest, guardian_name: guardianName ?? null }],
        forms: [],
        submissions: [],
      }),
    });
  },
  /** Force-push all growth visit submissions for a patient directly to the backend.
   *  Safe to call even after drain — backend deduplicates by submission ID. */
  pushPatientVisits: async (patientId: string) => {
    const token = getToken();
    if (!token) return;
    const visits = state.submissions.filter(
      (s) => s.patientId === patientId && s.formId === "__growth_visit__",
    );
    if (!visits.length) return;
    await api("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        patients: [],
        forms: [],
        submissions: visits.map(({ ownerId: _o, createdAt: _c, ...rest }) => ({
          id: rest.id,
          patient_id: rest.patientId,
          form_id: rest.formId,
          form_name: rest.formName,
          data: rest.data,
        })),
      }),
    });
  },
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
  setTimeout(() => { void drain(); }, 1500);
  // Periodic background sync every 2 minutes while logged in and online
  setInterval(() => {
    if (getToken() && (typeof navigator === "undefined" || navigator.onLine)) {
      void drain();
      void pullSnapshot();
    }
  }, 2 * 60 * 1000);
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
