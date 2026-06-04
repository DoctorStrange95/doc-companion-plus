import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useStore, store, sync } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { AuthRequired } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { API_BASE, getToken } from "@/lib/api";
import {
  Download, Wifi, WifiOff, LogOut, RefreshCw, AlertTriangle,
  Edit2, Check, X, Trash2, Zap, Crown, Building2, Sparkles, MailCheck, ShieldCheck,
  Users, Loader2, ShieldAlert, BarChart2, ChevronDown, ChevronUp, Table2,
} from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

const ROLES = ["Nurse", "Doctor", "Researcher", "Student", "Community Worker"] as const;

const PLANS = [
  {
    id: "free",
    name: "Free",
    badge: "Early Access",
    price: null,
    icon: Sparkles,
    color: "bg-primary",
    features: ["Lifetime free — selected by core team", "Up to 5 forms", "500 submissions / month", "Offline-first sync"],
    cta: null,
  },
  {
    id: "pro",
    name: "Pro",
    badge: "₹99 / month",
    price: "₹99",
    period: "month",
    icon: Zap,
    color: "bg-blue-400",
    features: ["100 forms", "10,000 submissions / month", "Priority support", "CSV & JSON export", "Analytics dashboard"],
    cta: "Upgrade to Pro",
  },
  {
    id: "max",
    name: "Max",
    badge: "₹499 / month",
    price: "₹499",
    period: "month",
    icon: Crown,
    color: "bg-violet-400",
    features: ["Unlimited forms", "50,000 submissions / month", "All Pro features", "Team sharing & collaboration", "Dedicated onboarding"],
    cta: "Upgrade to Max",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    badge: "Custom",
    price: null,
    icon: Building2,
    color: "bg-zinc-700",
    features: ["Unlimited everything", "Custom data retention", "On-premise option", "SLA & compliance docs", "Dedicated support"],
    cta: "Contact support",
  },
] as const;

function Settings() {
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const queue = useStore((s) => s.queue);
  const lastSync = useStore((s) => s.lastSync);

  const { user, logout, updateProfile, deleteAccount, resendVerification } = useAuth();
  const nav = useNavigate();

  // Profile edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name ?? "");
  const [editPhone, setEditPhone] = useState(user?.phone ?? "");
  const [editRole, setEditRole] = useState(user?.best_suited_role ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete state
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm" | "typing">("idle");
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Email verification state
  const [resending, setResending] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendError, setResendError] = useState("");

  // Sync state
  const [syncError, setSyncError] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const syncStuck = queue.length > 10 && lastSync && (Date.now() - lastSync) > 5 * 60 * 1000;

  if (!user) return <AuthRequired action="access settings" />;

  const startEdit = () => {
    setEditName(user.name ?? "");
    setEditPhone(user.phone ?? "");
    setEditRole(user.best_suited_role ?? "");
    setSaveError("");
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setSaveError(""); };

  const saveProfile = async () => {
    if (!editPhone.trim()) {
      setSaveError("Phone number is required.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await updateProfile(editName.trim(), editPhone.trim(), editRole);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setSaveError(`Error ${e.status}: ${e.detail ?? "Failed to save"}`);
      } else {
        setSaveError((e as Error).message || "Failed to save — please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteText !== "DELETE") return;
    setDeleting(true);
    try {
      await deleteAccount();
      nav({ to: "/login", replace: true });
    } catch {
      setDeleting(false);
      setDeleteStep("idle");
    }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vyasa-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Settings" variant="dark" />
      <PageShell>

        {/* ── Trial disclaimer ── */}
        <div className="brutal mb-4 border-2 border-primary bg-primary/10 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest">Early Access — Beta</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Vyasa Research is currently under trial. The first cohort of users,
                selected by the core team, get <span className="font-bold text-foreground">free lifetime access</span>.
                Paid plans launch soon — your early-access tier is locked in forever.
              </p>
            </div>
          </div>
        </div>

        {/* ── Profile ── */}
        <section className="brutal p-4">
          <div className="flex items-center justify-between">
            <SectionTitle kicker="Account">Profile</SectionTitle>
            {!editing && (
              <button onClick={startEdit} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest hover:underline">
                <Edit2 className="h-3 w-3" /> Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Name</span>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-brutal" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Phone <span className="text-destructive">*</span></span>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="input-brutal" type="tel" required placeholder="+91 98765 43210" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Role</span>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="input-brutal">
                  <option value="">Select role</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {saveError && <p className="text-[11px] font-bold text-destructive uppercase tracking-wider">{saveError}</p>}
              <div className="flex gap-2">
                <button onClick={saveProfile} disabled={saving} className="btn-brutal flex items-center gap-1.5 text-xs disabled:opacity-50">
                  <Check className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={cancelEdit} className="btn-brutal flex items-center gap-1.5 bg-card text-xs">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Name</span>
                <p className="text-sm font-bold">{user.name || "—"}</p>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Email</span>
                <p className="text-sm font-bold">{user.email}</p>
              </div>
              {user.phone && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Phone</span>
                  <p className="text-sm font-bold">{user.phone}</p>
                </div>
              )}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Role</span>
                <p className="text-sm font-bold">{user.best_suited_role || "Not set"}</p>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <div className="flex items-center gap-1.5">
                  {user.email_verified ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <MailCheck className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${user.email_verified ? "text-green-700" : "text-amber-700"}`}>
                    {user.email_verified ? "Email verified" : "Email not verified"}
                  </span>
                </div>
                {!user.email_verified && (
                  <button
                    onClick={async () => {
                      setResending(true);
                      setResendError("");
                      try {
                        await resendVerification();
                        setResendDone(true);
                      } catch {
                        setResendError("Failed to send — try again.");
                      } finally {
                        setResending(false);
                      }
                    }}
                    disabled={resending || resendDone}
                    className="text-[10px] font-bold uppercase tracking-widest text-amber-700 underline disabled:opacity-50"
                  >
                    {resendDone ? "Email sent ✓" : resending ? "Sending…" : "Resend link"}
                  </button>
                )}
              </div>
              {resendError && <p className="text-[10px] font-bold text-destructive uppercase tracking-wider">{resendError}</p>}
            </div>
          )}
        </section>

        {/* ── Plan / Pricing ── */}
        <section className="brutal mt-4 p-4">
          <SectionTitle kicker="Subscription">Your plan</SectionTitle>
          <div className="mb-3 inline-flex items-center gap-2 border-2 border-primary bg-primary/10 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[11px] font-bold uppercase tracking-widest">Free — Early Access</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {PLANS.map((plan) => {
              const Icon = plan.icon;
              const isCurrent = plan.id === "free";
              return (
                <div key={plan.id} className={`brutal p-3 ${isCurrent ? "border-primary" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border ${plan.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest">{plan.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground">{plan.badge}</p>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="border-2 border-primary bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                        Current
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        <Check className="h-3 w-3 shrink-0 text-foreground" /> {f}
                      </li>
                    ))}
                  </ul>
                  {plan.cta && !isCurrent && (
                    <button
                      onClick={() => {
                        if (plan.id === "enterprise") {
                          window.open("mailto:support@vyasaa.com?subject=Enterprise enquiry", "_blank");
                        } else {
                          alert("Paid plans launching soon. You'll be notified at " + user.email);
                        }
                      }}
                      className="btn-brutal mt-3 w-full text-[11px]"
                    >
                      {plan.cta}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Sync status ── */}
        <section className="brutal mt-4 p-4">
          <SectionTitle kicker="Sync">Status</SectionTitle>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            {online
              ? <><Wifi className="h-4 w-4" /> Online — auto-sync</>
              : <><WifiOff className="h-4 w-4 text-destructive" /> Offline — queued</>}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {patients.length} patients · {submissions.length} responses on device
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {queue.length > 0 ? `${queue.length} pending change${queue.length === 1 ? "" : "s"} · ` : "All changes synced · "}
            {lastSync ? `last sync ${new Date(lastSync).toLocaleTimeString()}` : "never synced"}
          </div>
          {syncStuck && (
            <div className="mt-2 flex items-start gap-2 border-2 border-destructive bg-destructive/10 p-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                Sync appears stuck. Sign out and sign back in — this usually fixes it.
              </p>
            </div>
          )}
          {syncError && <p className="mt-1 text-[11px] font-bold text-destructive">{syncError}</p>}
          <button
            onClick={async () => {
              if (isSyncing) return;
              setSyncError("");
              setSyncDone(false);
              setIsSyncing(true);
              try {
                await sync.drain();
                await sync.pull();
                setSyncDone(true);
                setTimeout(() => setSyncDone(false), 2500);
              } catch {
                setSyncError("Sync failed — check your connection and try again.");
              } finally {
                setIsSyncing(false);
              }
            }}
            disabled={isSyncing || !online || !user}
            className={`btn-brutal mt-3 flex w-full items-center justify-center gap-2 disabled:opacity-50 transition-colors ${syncDone ? "bg-green-400 border-green-600" : "bg-card"}`}
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing…" : syncDone ? "Synced ✓" : "Sync now"}
          </button>
        </section>

        {/* ── Data export ── */}
        <section className="brutal mt-4 p-4">
          <SectionTitle kicker="Data">Export</SectionTitle>
          <button onClick={exportData} className="btn-brutal flex w-full items-center justify-center gap-2 bg-card">
            <Download className="h-4 w-4" /> Export all data (JSON)
          </button>
        </section>

        {/* ── Admin panel ── */}
        {user.role === "admin" && <AdminPanel />}

        {/* ── Danger zone ── */}
        <section className="brutal mt-4 border-destructive p-4">
          <SectionTitle kicker="Danger zone">Account actions</SectionTitle>
          <div className="space-y-2">
            {queue.length > 0 && (
              <div className="flex items-start gap-2 border-2 border-amber-500 bg-amber-50 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-[11px] font-bold text-amber-800">
                    {queue.length} change{queue.length !== 1 ? "s" : ""} not yet synced to server.
                    Signing out now will permanently delete this data.
                  </p>
                  <p className="text-[10px] text-amber-700 mt-0.5">
                    Go online and tap Sync first, then sign out.
                  </p>
                </div>
              </div>
            )}
            <button
              onClick={() => void logout()}
              className="btn-brutal flex w-full items-center justify-center gap-2 bg-destructive text-destructive-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>

            {deleteStep === "idle" && (
              <button
                onClick={() => setDeleteStep("confirm")}
                className="btn-brutal flex w-full items-center justify-center gap-2 bg-card text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete account permanently
              </button>
            )}

            {deleteStep === "confirm" && (
              <div className="border-2 border-destructive bg-destructive/10 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                  This permanently deletes all your forms, patients, and responses from the server. This cannot be undone.
                </p>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-widest">Type DELETE to confirm</p>
                <input
                  className="input-brutal mt-1 border-destructive"
                  placeholder="DELETE"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleteText !== "DELETE" || deleting}
                    className="btn-brutal flex items-center gap-1.5 bg-destructive text-destructive-foreground text-xs disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button onClick={() => { setDeleteStep("idle"); setDeleteText(""); }} className="btn-brutal bg-card text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Vyasa Research · Beta v0.4 · Build 188
        </p>
      </PageShell>
    </>
  );
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  best_suited_role: string;
  email_verified: boolean;
  created_at: string;
  form_count: number;
  submission_count: number;
}

interface AdminForm {
  id: string;
  name: string;
  category: string;
  owner_email: string;
  owner_name: string;
  status: string;
  response_count: number;
  created_at: string;
}

interface AdminAssignee {
  share_id: string;
  email: string;
  name: string;
  can_fill: boolean;
  can_view: boolean;
  can_edit: boolean;
  response_count: number;
}

type AdminTab = "users" | "forms" | "data";

function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>("data");

  const TAB_LABELS: Record<AdminTab, string> = {
    data: "📊 Data",
    users: "👥 Users",
    forms: "📋 Deploy",
  };

  return (
    <section className="brutal mt-4 border-secondary">
      {/* Tab bar */}
      <div className="flex border-b-2 border-border">
        {(["data", "users", "forms"] as AdminTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-widest border-r last:border-r-0 border-border ${
              tab === t ? "bg-secondary text-secondary-foreground" : "bg-card hover:bg-muted"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "data" && <AdminDataTab />}
      {tab === "users" && <AdminUsersTab />}
      {tab === "forms" && <AdminFormsTab />}
    </section>
  );
}

// ── Admin Data Tab ────────────────────────────────────────────────────────────

interface AdminFormField { id: string; label: string; type: string; variableName: string; }
interface AdminSubmission { id: string; created_at: string; owner_email: string; owner_name: string; data: Record<string, unknown>; }
interface AdminFormData { form: { id: string; name: string; category: string; fields: AdminFormField[] }; submissions: AdminSubmission[]; }

function cellValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("lat" in obj && "lng" in obj) return `${(obj.lat as number).toFixed(5)},${(obj.lng as number).toFixed(5)}`;
    return JSON.stringify(v);
  }
  return String(v);
}

function exportAdminCsv(fd: AdminFormData) {
  const { form, submissions } = fd;
  const headers = ["#", "Date", "Time", "Respondent", ...form.fields.map((f) => f.variableName || f.label)];
  const rows = submissions.map((s, i) => {
    const dt = new Date(s.created_at);
    const vals = form.fields.map((f) => `"${cellValue(s.data[f.id]).replace(/"/g, '""')}"`);
    return [`${i + 1}`, dt.toLocaleDateString("en-GB"), dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), `"${s.owner_email}"`, ...vals].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${form.name.replace(/[^a-z0-9]/gi, "_")}_admin.csv`; a.click();
}

function AdminDataTab() {
  const [forms, setForms] = useState<AdminForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AdminFormData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [search, setSearch] = useState("");

  const fetchForms = async () => {
    setLoading(true); setError("");
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      setForms(await res.json() as AdminForm[]);
    } catch (e) { setError(`Failed: ${e instanceof Error ? e.message : "unknown"}`); }
    finally { setLoading(false); }
  };

  const loadFormData = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setFormData(null); return; }
    setSelectedId(id); setFormData(null); setLoadingData(true);
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms/${id}/data`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      setFormData(await res.json() as AdminFormData);
    } catch (e) { setError(`${e instanceof Error ? e.message : "unknown"}`); }
    finally { setLoadingData(false); }
  };

  useEffect(() => { void fetchForms(); }, []);

  const filtered = forms.filter((f) =>
    !search || f.name.toLowerCase().includes(search.toLowerCase()) || f.owner_email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 space-y-3">
      {/* search + refresh */}
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search forms…"
          className="flex-1 border-2 border-border bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        <button onClick={() => void fetchForms()} disabled={loading}
          className="flex items-center gap-1.5 border-2 border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <p className="text-[11px] font-bold text-destructive border-2 border-destructive px-3 py-2">{error}</p>}
      {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      <div className="space-y-2">
        {filtered.map((f) => (
          <div key={f.id} className="border-2 border-border">
            <button type="button" onClick={() => void loadFormData(f.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold truncate">{f.name}</span>
                  <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest border ${
                    f.status === "active" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}>{f.status}</span>
                  <span className="text-[9px] font-bold uppercase tracking-widest border border-border px-1.5 py-0.5">{f.response_count} resp</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{f.category} · {f.owner_name || f.owner_email}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                {selectedId === f.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </div>
            </button>

            {selectedId === f.id && (
              <div className="border-t-2 border-border bg-card">
                {loadingData && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                {formData && <AdminResponseTable fd={formData} />}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-4">No forms found.</p>}
      </div>
    </div>
  );
}

function AdminResponseTable({ fd }: { fd: AdminFormData }) {
  const { form, submissions } = fd;
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (submissions.length === 0) {
    return <div className="px-4 py-6 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">No responses yet</div>;
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <BarChart2 className="inline h-3 w-3 mr-1" />{submissions.length} response{submissions.length !== 1 ? "s" : ""}
        </span>
        <button onClick={() => exportAdminCsv(fd)}
          className="flex items-center gap-1.5 border-2 border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-muted">
          <Download className="h-3 w-3" /> CSV
        </button>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto border-2 border-border">
        <table className="w-full text-[10px]" style={{ minWidth: `${Math.max(400, form.fields.length * 120)}px` }}>
          <thead>
            <tr className="border-b-2 border-border bg-muted">
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest whitespace-nowrap border-r border-border">#</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest whitespace-nowrap border-r border-border">Date</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest whitespace-nowrap border-r border-border">By</th>
              {form.fields.map((f) => (
                <th key={f.id} className="px-2 py-1.5 text-left font-bold uppercase tracking-widest whitespace-nowrap border-r last:border-r-0 border-border max-w-[160px]">
                  <span className="block truncate max-w-[140px]" title={f.label}>{f.variableName || f.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {submissions.map((s, i) => {
              const dt = new Date(s.created_at);
              const isExp = expandedRow === s.id;
              return (
                <tr key={s.id} onClick={() => setExpandedRow(isExp ? null : s.id)}
                  className={`border-b border-border cursor-pointer hover:bg-muted/60 ${isExp ? "bg-muted" : i % 2 === 0 ? "bg-card" : "bg-background"}`}>
                  <td className="px-2 py-1.5 font-bold tabular-nums border-r border-border">{submissions.length - i}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap border-r border-border text-muted-foreground">
                    {dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{" "}
                    <span className="text-[9px]">{dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </td>
                  <td className="px-2 py-1.5 border-r border-border max-w-[120px]">
                    <span className="block truncate text-[9px]" title={s.owner_email}>{s.owner_name || s.owner_email.split("@")[0]}</span>
                  </td>
                  {form.fields.map((f) => (
                    <td key={f.id} className="px-2 py-1.5 border-r last:border-r-0 border-border max-w-[160px]">
                      <span className={`block truncate ${isExp ? "" : "max-w-[140px]"}`} title={cellValue(s.data[f.id])}>{cellValue(s.data[f.id])}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-muted-foreground">Tap a row to expand. Scroll right to see all fields.</p>
    </div>
  );
}

function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      setUsers(await res.json() as AdminUser[]);
      setLoaded(true);
    } catch (e) {
      setError(`Failed to load users: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchUsers(); }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Users className="inline h-3.5 w-3.5 mr-1" />{loaded ? `${users.length} registered` : "Loading…"}
        </span>
        <button onClick={() => void fetchUsers()} disabled={loading}
          className="flex items-center gap-1.5 border-2 border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-2 border-destructive bg-destructive/10 px-3 py-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-[11px] font-bold text-destructive">{error}</p>
        </div>
      )}
      {loading && !loaded && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {loaded && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {users.map((u) => (
            <div key={u.id} className="border border-border bg-card px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">{u.name || u.email}</span>
                    {u.role === "admin" && <span className="border border-secondary bg-secondary/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest">admin</span>}
                    {!u.email_verified && <span className="border border-amber-500 bg-amber-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-700">unverified</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{u.email}</div>
                  {u.best_suited_role && <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{u.best_suited_role}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{u.form_count} form{u.form_count !== 1 ? "s" : ""}</div>
                  <div className="text-[10px] text-muted-foreground">{u.submission_count} response{u.submission_count !== 1 ? "s" : ""}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    Joined {new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminFormsTab() {
  const [forms, setForms] = useState<AdminForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchForms = async () => {
    setLoading(true);
    setError("");
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      setForms(await res.json() as AdminForm[]);
      setLoaded(true);
    } catch (e) {
      setError(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchForms(); }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
          Deploy a form → users get it in their Forms list. They fill their own copy. You see all responses.
        </p>
        <button onClick={() => void fetchForms()} disabled={loading}
          className="shrink-0 flex items-center gap-1.5 border-2 border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-2 border-destructive bg-destructive/10 px-3 py-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-[11px] font-bold text-destructive">{error}</p>
        </div>
      )}
      {loading && !loaded && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {loaded && (
        <div className="space-y-2">
          {forms.map((f) => (
            <div key={f.id} className="border-2 border-border">
              {/* Form header row */}
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">{f.name}</span>
                    <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest border ${
                      f.status === "active" ? "border-primary bg-primary/10 text-primary" :
                      f.status === "closed" ? "border-destructive text-destructive" : "border-border text-muted-foreground"
                    }`}>{f.status}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {f.category} · Owner: {f.owner_name || f.owner_email} · {f.response_count} responses
                  </div>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-primary">
                  {expandedId === f.id ? "▲ Close" : "Deploy ▼"}
                </span>
              </button>

              {/* Expanded deploy panel */}
              {expandedId === f.id && (
                <div className="border-t-2 border-border bg-card">
                  <AdminDeployPanel formId={f.id} formName={f.name} />
                </div>
              )}
            </div>
          ))}
          {forms.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-4">No forms found.</p>}
        </div>
      )}
    </div>
  );
}

function AdminDeployPanel({ formId, formName }: { formId: string; formName: string }) {
  const [assignees, setAssignees] = useState<AdminAssignee[]>([]);
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState({ fill: true, view: false, edit: false });
  const [deploying, setDeploying] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadAssignees = async () => {
    setLoadingAssignees(true);
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms/${formId}/assignees`, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.ok) setAssignees(await res.json() as AdminAssignee[]);
    } finally {
      setLoadingAssignees(false);
    }
  };

  useEffect(() => { void loadAssignees(); }, [formId]);

  const handleDeploy = async () => {
    if (!email.includes("@")) { setMsg({ text: "Enter a valid email.", ok: false }); return; }
    setDeploying(true);
    setMsg(null);
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/admin/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ form_id: formId, email, can_fill: perms.fill, can_view: perms.view, can_edit: perms.edit }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" })) as { detail?: string };
        setMsg({ text: body.detail ?? "Deploy failed.", ok: false });
      } else {
        const newAssignee = await res.json() as AdminAssignee;
        setAssignees((prev) => {
          const exists = prev.findIndex((a) => a.share_id === newAssignee.share_id);
          return exists >= 0 ? prev.map((a, i) => i === exists ? newAssignee : a) : [...prev, newAssignee];
        });
        setEmail("");
        setMsg({ text: `Form deployed to ${newAssignee.email}`, ok: true });
      }
    } catch {
      setMsg({ text: "Network error — try again.", ok: false });
    } finally {
      setDeploying(false);
    }
  };

  const handleRevoke = async (shareId: string, userEmail: string) => {
    const tok = getToken();
    const res = await fetch(`${API_BASE}/api/admin/shares/${shareId}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    if (res.ok || res.status === 204) {
      setAssignees((prev) => prev.filter((a) => a.share_id !== shareId));
      setMsg({ text: `Revoked from ${userEmail}`, ok: true });
    }
  };

  const permLabels: Record<string, string> = {
    fill: "Can fill (data collector)",
    view: "Can view all responses",
    edit: "Can edit form + sub-share to team (mini-admin)",
  };

  return (
    <div className="p-3 space-y-4">
      {/* Permission presets */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Role</div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: "Collector", fill: true, view: false, edit: false },
            { label: "Viewer", fill: true, view: true, edit: false },
            { label: "Mini-admin", fill: true, view: true, edit: true },
          ].map((preset) => {
            const active = perms.fill === preset.fill && perms.view === preset.view && perms.edit === preset.edit;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setPerms({ fill: preset.fill, view: preset.view, edit: preset.edit })}
                className={`border-2 border-border py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${active ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="space-y-1">
          {(["fill", "view", "edit"] as const).map((p) => (
            <label key={p} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={perms[p]} onChange={(e) => setPerms((prev) => ({ ...prev, [p]: e.target.checked }))} className="h-3.5 w-3.5 accent-primary" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{permLabels[p]}</span>
            </label>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground italic">
          {perms.edit ? "Mini-admin: can use 'Manage team' to add their own collaborators." :
           perms.view ? "Can see all responses for this form." :
           "Fill only: sees only their own responses."}
        </p>
      </div>

      {/* Email + deploy */}
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void handleDeploy(); }}
          className="input-brutal flex-1 text-sm"
        />
        <button onClick={() => void handleDeploy()} disabled={deploying}
          className="btn-brutal shrink-0 text-xs disabled:opacity-50">
          {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deploy"}
        </button>
      </div>

      {msg && <p className={`text-[11px] font-bold ${msg.ok ? "text-primary" : "text-destructive"}`}>{msg.text}</p>}

      {/* Current assignees */}
      {loadingAssignees && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {assignees.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Currently deployed to</div>
          {assignees.map((a) => (
            <div key={a.share_id} className="flex items-center gap-2 border border-border bg-background px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold truncate">{a.name || a.email}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{a.email}</div>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {a.can_fill && <span className="border border-border px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest">Fill</span>}
                  {a.can_view && <span className="border border-border px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest">View</span>}
                  {a.can_edit && <span className="border border-secondary bg-secondary/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest">Mini-admin</span>}
                  <span className="text-[9px] text-muted-foreground self-center">{a.response_count} response{a.response_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <button
                onClick={() => void handleRevoke(a.share_id, a.email)}
                className="shrink-0 border-2 border-destructive px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {!loadingAssignees && assignees.length === 0 && (
        <p className="text-[10px] text-muted-foreground">Not deployed to anyone yet. Add an email above.</p>
      )}

      {/* Link to master sheet */}
      <a
        href={`/forms/${formId}/responses`}
        className="flex items-center justify-center gap-2 border-2 border-border py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20"
      >
        View master sheet (all responses) →
      </a>
      <p className="text-[9px] text-muted-foreground text-center">
        "{formName}" — you see every response from every user as the owner.
      </p>
    </div>
  );
}
