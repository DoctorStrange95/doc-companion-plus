import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, store, sync } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { AuthRequired } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import {
  Download, Wifi, WifiOff, LogOut, RefreshCw, AlertTriangle,
  Edit2, Check, X, Trash2, Zap, Crown, Building2, Sparkles,
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
    features: ["Lifetime free — selected by core team", "Up to 10 forms", "1,000 submissions", "Offline-first sync"],
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

  const { user, logout, updateProfile, deleteAccount } = useAuth();
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
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Phone</span>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="input-brutal" type="tel" />
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

        {/* ── Danger zone ── */}
        <section className="brutal mt-4 border-destructive p-4">
          <SectionTitle kicker="Danger zone">Account actions</SectionTitle>
          <div className="space-y-2">
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
