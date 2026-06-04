import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useStore, store, sync } from "@/lib/store";
import { getToken, API_BASE } from "@/lib/api";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  Edit2, Copy, Trash2, ExternalLink, BarChart2,
  Share2, X, CheckCircle2, AlertTriangle,
  User, Globe, List, ArrowRight, Link2, Link2Off, Loader2, Lock, Plus, Printer,
  Clock, UserCheck, UserX, RefreshCw, Smartphone,
} from "lucide-react";

interface FormShareEntry {
  id: string;
  email: string;
  canFill: boolean;
  canView: boolean;
  canEdit: boolean;
}

interface AccessRequest {
  id: string;
  requester_email: string;
  requester_name: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
}

function PendingRequestsPanel({ formId }: { formId: string }) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, { fill: boolean; view: boolean; edit: boolean }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/forms/${formId}/access-requests`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json() as AccessRequest[];
        setRequests(data);
        const p: Record<string, { fill: boolean; view: boolean; edit: boolean }> = {};
        data.forEach((r) => { p[r.id] = { fill: true, view: false, edit: false }; });
        setPerms(p);
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    // Poll every 30s so new requests appear without manual refresh
    const t = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const handleApprove = async (req: AccessRequest) => {
    setApproving(req.id);
    const p = perms[req.id] ?? { fill: true, view: false, edit: false };
    const tok = getToken();
    try {
      const res = await fetch(`${API_BASE}/api/forms/${formId}/access-requests/${req.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ can_fill: p.fill, can_view: p.view, can_edit: p.edit }),
      });
      if (res.ok) {
        setRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r));
        setMsg((prev) => ({ ...prev, [req.id]: `Approved — ${req.requester_email} can now access this form.` }));
      }
    } catch { /* ignore */ } finally { setApproving(null); }
  };

  const handleDeny = async (req: AccessRequest) => {
    setApproving(req.id);
    const tok = getToken();
    try {
      await fetch(`${API_BASE}/api/forms/${formId}/access-requests/${req.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
      setRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "denied" } : r));
      setMsg((prev) => ({ ...prev, [req.id]: "Request denied." }));
    } catch { /* ignore */ } finally { setApproving(null); }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-border text-[10px] font-black">3</span>
          Access requests
          {pending.length > 0 && (
            <span className="border-2 border-primary bg-primary px-1.5 py-0.5 text-[9px] font-black">{pending.length}</span>
          )}
        </div>
        <button onClick={() => void load()} disabled={loading} className="border border-border p-1 hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !loaded && <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}

      {loaded && pending.length === 0 && reviewed.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No access requests yet. When users click your fill link, they'll see a "Request access" button.</p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Pending ({pending.length})</div>
          {pending.map((req) => (
            <div key={req.id} className="border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold">{req.requester_name || req.requester_email}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{req.requester_email}</div>
                  <div className="text-[9px] text-muted-foreground">
                    Requested {new Date(req.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                </div>
                <Clock className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              </div>

              {/* Role preset */}
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: "Collector", fill: true, view: false, edit: false },
                  { label: "Viewer", fill: true, view: true, edit: false },
                  { label: "Mini-admin", fill: true, view: true, edit: true },
                ].map((preset) => {
                  const p = perms[req.id] ?? { fill: true, view: false, edit: false };
                  const active = p.fill === preset.fill && p.view === preset.view && p.edit === preset.edit;
                  return (
                    <button key={preset.label} type="button"
                      onClick={() => setPerms((prev) => ({ ...prev, [req.id]: { fill: preset.fill, view: preset.view, edit: preset.edit } }))}
                      className={`border border-border py-1.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${active ? "bg-primary" : "bg-card hover:bg-primary/20"}`}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void handleApprove(req)}
                  disabled={approving === req.id}
                  className="flex-1 flex items-center justify-center gap-1.5 border-2 border-primary bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-primary/80"
                >
                  {approving === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                  Approve
                </button>
                <button
                  onClick={() => void handleDeny(req)}
                  disabled={approving === req.id}
                  className="flex items-center gap-1.5 border-2 border-destructive px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <UserX className="h-3.5 w-3.5" /> Deny
                </button>
              </div>
              {msg[req.id] && <p className="text-[10px] font-bold text-primary">{msg[req.id]}</p>}
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Reviewed ({reviewed.length})</div>
          {reviewed.map((req) => (
            <div key={req.id} className="flex items-center gap-2 border border-border px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold truncate">{req.requester_email}</div>
              </div>
              <span className={`shrink-0 border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${req.status === "approved" ? "border-primary text-primary" : "border-destructive text-destructive"}`}>
                {req.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/forms/$id")({ component: FormsIdLayout });

/** Layout wrapper — renders FormDetail when at /forms/:id exactly, child route otherwise. */
function FormsIdLayout() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isIndex = pathname === `/forms/${id}` || pathname === `/forms/${id}/`;
  return isIndex ? <FormDetail /> : <Outlet />;
}

function fmtCellVal(val: unknown): string {
  if (val === undefined || val === null || val === "") return "—";
  if (typeof val === "object" && val !== null) {
    const o = val as Record<string, unknown>;
    if ("systolic" in o) return `${o.systolic}/${o.diastolic}`;
    return JSON.stringify(val);
  }
  return String(val);
}

function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "active";
  const styles = {
    active: "bg-primary text-primary-foreground",
    draft: "bg-muted text-muted-foreground",
    closed: "bg-destructive text-destructive-foreground",
  }[s] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block border-2 border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${styles}`}>
      {s}
    </span>
  );
}

function FormDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const lastSync = useStore((s) => s.lastSync); // eslint-disable-line @typescript-eslint/no-unused-vars
  const allSubmissions = useStore((s) => s.submissions);
  const submissions = useMemo(() => allSubmissions.filter((s) => s.formId === id), [allSubmissions, id]);
  const allLongitudinalSubs = useStore(s => s.longitudinalSubmissions);
  const longitudinalSubs = useMemo(() => allLongitudinalSubs.filter(sub => sub.formId === id), [allLongitudinalSubs, id]);
  const [activeTab, setActiveTab] = useState<'overview' | 'longitudinal'>('overview');
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  const [showShare, setShowShare] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [copied, setCopied] = useState<"fill" | "analytics" | null>(null);
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"draft" | "active" | "closed" | null>(null);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferStep, setTransferStep] = useState(0);
  const [transferMsg, setTransferMsg] = useState("");

  // Share modal state
  const [shares, setShares] = useState<FormShareEntry[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessRole, setAccessRole] = useState<"fill" | "fill-view" | "admin">("fill-view");
  const [inviteWorking, setInviteWorking] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // legacy compat — keep inviteEmail/invitePerms for handleInvite which we still call internally
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePerms, setInvitePerms] = useState({ fill: true, view: true, edit: false });
  const [tokenWorking, setTokenWorking] = useState<"fill" | "analytics" | null>(null);
  const [tokenMsg, setTokenMsg] = useState<{ text: string; ok: boolean } | null>(null);


  const formId = form?.id;

  const [showDuplicateBanner, setShowDuplicateBanner] = useState(false);

  // Auto-open share modal + show banner when navigating here after auto-duplicate
  useEffect(() => {
    if (sessionStorage.getItem("autoOpenShare") === id) {
      sessionStorage.removeItem("autoOpenShare");
      setShowShare(true);
    }
    if (sessionStorage.getItem("autoDuplicateBanner") === "1") {
      sessionStorage.removeItem("autoDuplicateBanner");
      setShowDuplicateBanner(true);
    }
  }, [id]);

  // Poll for pending access requests (badge on Share button)
  useEffect(() => {
    if (!formId || !form?.shareToken) return;
    const tok = getToken();
    if (!tok) return;
    const check = () => {
      fetch(`${API_BASE}/api/forms/${formId}/access-requests`, { headers: { Authorization: `Bearer ${tok}` } })
        .then((r) => r.ok ? r.json() as Promise<AccessRequest[]> : [])
        .then((data) => setPendingRequestCount((data as AccessRequest[]).filter((r) => r.status === "pending").length))
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, form?.shareToken]);

  // When the share modal opens: ensure the form exists in the backend DB.
  // Seed forms and forms created offline have no ownerId — push them directly
  // so share-token generation succeeds on the first attempt without a 403 retry.
  useEffect(() => {
    if (!showShare || !form) return;
    if (!form.ownerId) {
      void sync.pushForm(form)
        .then(() => sync.pull())
        .catch(() => {});
    } else {
      void sync.drain();
    }
  }, [showShare, form?.ownerId]);

  useEffect(() => {
    if (!showShare || !formId) return;
    let cancelled = false;
    const tok = getToken();
    if (!tok) return;
    setSharesLoading(true);
    fetch(`${API_BASE}/api/forms/${formId}/shares`, { headers: { Authorization: `Bearer ${tok}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Array<{ id: string; shared_with_email: string; can_fill: boolean; can_view: boolean; can_edit: boolean }>) => {
        if (!cancelled) setShares(data.map((s) => ({ id: s.id, email: s.shared_with_email, canFill: s.can_fill, canView: s.can_view, canEdit: s.can_edit })));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSharesLoading(false); });
    return () => { cancelled = true; };
  }, [showShare, formId]);

  // PWA: swap manifest to form-specific + capture install prompt
  useEffect(() => {
    if (!formId) return;
    const manifestUrl = `${API_BASE}/api/forms/${formId}/manifest.json`;
    const el = document.getElementById("app-manifest") as HTMLLinkElement | null;
    const prev = el?.href ?? "";
    if (el) el.href = manifestUrl;

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => {
      if (el) el.href = "/manifest.json";
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, [formId]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = installPrompt as any;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  const handleGenerateToken = async (type: "fill" | "analytics") => {
    if (!form) return;
    const tok = getToken();
    if (!tok) return;
    setTokenWorking(type);
    setTokenMsg(null);
    const doGenerate = async () =>
      fetch(`${API_BASE}/api/forms/${form.id}/share-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ type }),
      });
    try {
      let res = await doGenerate();
      // 403 = form not yet in DB. Push it now and retry once.
      if (res.status === 403) {
        try {
          await sync.pushForm(form);
        } catch {
          // Form is owned by a different account on this server (e.g. a seeded template
          // that another account pushed first). Auto-duplicate with a fresh ID.
          setTokenWorking(null);
          const copy = store.duplicateForm(form.id);
          // Keep original name and status — "Copy of" is confusing and the copy
          // becomes the user's own form so it should behave like the original.
          store.updateForm(copy.id, {
            name: form.name,
            status: form.status ?? "active",
          });
          sessionStorage.setItem("autoOpenShare", copy.id);
          sessionStorage.setItem("autoDuplicateBanner", "1");
          nav({ to: "/forms/$id", params: { id: copy.id } });
          return;
        }
        res = await doGenerate();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" }));
        setTokenMsg({ text: body.detail ?? "Failed to generate link", ok: false });
        return;
      }
      const { token } = await res.json() as { token: string };
      store.updateForm(form.id, type === "fill" ? { shareToken: token } : { analyticsToken: token });
      // Pull so local state gets the server-assigned ownerId for this form
      void sync.pull().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : null;
      setTokenMsg({ text: msg ?? "Failed to generate link — try again.", ok: false });
    } finally {
      setTokenWorking(null);
    }
  };

  const handleRevokeToken = async (type: "fill" | "analytics") => {
    if (!form) return;
    const tok = getToken();
    if (!tok) return;
    setTokenWorking(type);
    setTokenMsg(null);
    const doRevoke = () =>
      fetch(`${API_BASE}/api/forms/${form.id}/share-token?type=${type}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
    try {
      let res = await doRevoke();
      if (res.status === 403) {
        await sync.pushForm(form);
        res = await doRevoke();
      }
      if (res.ok) {
        store.updateForm(form.id, type === "fill" ? { shareToken: undefined } : { analyticsToken: undefined });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : null;
      setTokenMsg({ text: msg ?? "Failed to revoke link — try again.", ok: false });
    } finally {
      setTokenWorking(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.includes("@")) { setInviteMsg({ text: "Enter a valid email.", ok: false }); return; }
    if (!invitePerms.fill && !invitePerms.view && !invitePerms.edit) {
      setInviteMsg({ text: "Select at least one permission.", ok: false }); return;
    }
    const tok = getToken();
    if (!tok || !form) return;
    setInviteWorking(true);
    setInviteMsg(null);
    const doInvite = () =>
      fetch(`${API_BASE}/api/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ resource_type: "form", resource_id: form.id, email: inviteEmail, can_fill: invitePerms.fill, can_view: invitePerms.view, can_edit: invitePerms.edit }),
      });
    try {
      let res = await doInvite();
      // 403 = form not yet in DB — push it now and retry once, silently
      if (res.status === 403) {
        await sync.pushForm(form);
        res = await doInvite();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" }));
        let msg = body.detail ?? "Failed";
        if (res.status === 403) {
          msg = "Could not verify ownership — check your connection and try again.";
        } else if (res.status === 404 && typeof msg === "string" && msg.toLowerCase().includes("no user registered")) {
          msg = `${inviteEmail} hasn't signed up yet. Ask them to create an account first, then share.`;
        }
        setInviteMsg({ text: msg, ok: false });
      } else {
        const shareData: { id: string; shared_with_email: string; can_fill: boolean; can_view: boolean; can_edit: boolean } = await res.json();
        const newShare = { id: shareData.id, email: shareData.shared_with_email, canFill: shareData.can_fill, canView: shareData.can_view, canEdit: shareData.can_edit };
        setShares((prev) => {
          const exists = prev.some((s) => s.id === newShare.id);
          return exists ? prev.map((s) => (s.id === newShare.id ? newShare : s)) : [...prev, newShare];
        });
        setInviteEmail("");
        setInvitePerms({ fill: true, view: true, edit: false });
        setInviteMsg({ text: "User added.", ok: true });
      }
    } catch {
      setInviteMsg({ text: "Failed. Check connection.", ok: false });
    } finally {
      setInviteWorking(false);
    }
  };

  const handleRemoveShare = async (shareId: string) => {
    const tok = getToken();
    if (!tok) return;
    await fetch(`${API_BASE}/api/shares/${shareId}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } }).catch(() => {});
    setShares((prev) => prev.filter((s) => s.id !== shareId));
  };

  // Unified "add access" — adds to allowedFillerEmails (link access for anyone) AND
  // tries to create a share for registered users (account integration).
  const handleAddAccess = async () => {
    const email = accessEmail.trim();
    if (!email.includes("@")) { setInviteMsg({ text: "Enter a valid email.", ok: false }); return; }
    if (!form) return;

    const perms = {
      fill: true,
      view: accessRole !== "fill",
      edit: accessRole === "admin",
    };

    // 1. Add to allowedFillerEmails (link access — works even without an account)
    const current = form.allowedFillerEmails ?? [];
    if (!current.some((x) => x.toLowerCase() === email.toLowerCase())) {
      store.updateForm(form.id, { allowedFillerEmails: [...current, email] });
    }

    // 2. Try to create a share (account integration for registered users)
    setInviteWorking(true);
    setInviteMsg(null);
    const tok = getToken();
    if (tok) {
      try {
        const doShare = () => fetch(`${API_BASE}/api/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ resource_type: "form", resource_id: form.id, email, can_fill: perms.fill, can_view: perms.view, can_edit: perms.edit }),
        });
        let res = await doShare();
        if (res.status === 403) { await sync.pushForm(form); res = await doShare(); }
        if (res.ok) {
          const shareData: { id: string; shared_with_email: string; can_fill: boolean; can_view: boolean; can_edit: boolean } = await res.json();
          const newShare = { id: shareData.id, email: shareData.shared_with_email, canFill: shareData.can_fill, canView: shareData.can_view, canEdit: shareData.can_edit };
          setShares((prev) => {
            const exists = prev.some((s) => s.id === newShare.id);
            return exists ? prev.map((s) => (s.id === newShare.id ? newShare : s)) : [...prev, newShare];
          });
          setInviteMsg({ text: `${email} added — they'll see this form in their account.`, ok: true });
        } else if (res.status === 404) {
          // Not a registered user — link access still works via allowedFillerEmails
          setInviteMsg({ text: `${email} added. They can fill via the link. (No account found — they won't see it in their app.)`, ok: true });
        } else {
          setInviteMsg({ text: `${email} added to link access.`, ok: true });
        }
      } catch {
        setInviteMsg({ text: `${email} added to link access.`, ok: true });
      } finally {
        setInviteWorking(false);
      }
    } else {
      setInviteWorking(false);
      setInviteMsg({ text: `${email} added.`, ok: true });
    }
    setAccessEmail("");
  };

  const handleRemoveAccess = async (email: string, shareId?: string) => {
    // Remove from allowedFillerEmails
    const current = form?.allowedFillerEmails ?? [];
    if (current.some((x) => x.toLowerCase() === email.toLowerCase())) {
      store.updateForm(form!.id, { allowedFillerEmails: current.filter((x) => x.toLowerCase() !== email.toLowerCase()) });
    }
    // Remove share if exists
    if (shareId) await handleRemoveShare(shareId);
  };

  if (!form) {
    return (
      <>
        <PageHeader title="Form" back="/forms" />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p>
        </PageShell>
      </>
    );
  }

  const responseCount = form.longitudinal
    ? longitudinalSubs.reduce((n, s) => n + s.visits.length, 0)
    : submissions.length;
  const fillLink = form.shareToken ? `${window.location.origin}/f/${form.shareToken}` : null;
  const analyticsLink = form.analyticsToken ? `${window.location.origin}/fa/${form.analyticsToken}` : null;
  const createdDate = new Date(form.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const copyToClipboard = async (text: string, which: "fill" | "analytics") => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const currentStatus = (form?.status ?? "active") as "draft" | "active" | "closed";
  const selectedStatus = pendingStatus ?? currentStatus;

  const saveStatus = () => {
    if (!pendingStatus || pendingStatus === currentStatus) return;
    setStatusSaving(true);
    setStatusError(null);
    // updateForm queues the change and calls drain() internally — no need to
    // call sync.pushForm separately (double-push caused state confusion).
    store.updateForm(form!.id, { status: pendingStatus });
    setPendingStatus(null);
    setStatusSaving(false);
  };

  const handleDuplicate = () => {
    const copy = store.duplicateForm(form.id);
    nav({ to: "/forms/$id", params: { id: copy.id } });
  };

  const handleDelete = () => {
    if (deleteStep === 0) { setDeleteStep(1); return; }
    if (deleteConfirmText !== form.name) return;
    store.deleteForm(form.id);
    nav({ to: "/forms" });
  };

  return (
    <>
      <PageHeader
        title={form.name}
        back="/forms"
        subtitle={`${form.category}${form.longitudinal ? " · Longitudinal" : ""}`}
        variant="yellow"
        action={
          <div className="flex items-center gap-2">
            <Link
              to="/forms/$id/print"
              params={{ id: form.id }}
              className="btn-brutal inline-flex items-center gap-1.5 text-xs"
              title="Print / Save PDF"
            >
              <Printer className="h-3.5 w-3.5" />
            </Link>
            {(!form.shared || form.canEdit) && (
              <Link
                to="/forms/new"
                search={{ edit: form.id }}
                className="btn-brutal inline-flex items-center gap-1.5 text-xs"
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
          </div>
        }
      />

      <PageShell>
        <div className="space-y-4">
          {/* Auto-duplicate notice */}
          {showDuplicateBanner && (
            <div className="flex items-start gap-3 border-2 border-primary bg-primary/10 p-3">
              <div className="flex-1 space-y-0.5">
                <p className="text-[11px] font-bold uppercase tracking-widest">Your personal copy</p>
                <p className="text-[11px] text-muted-foreground">
                  The original form was a shared template. We've created a personal copy for you — this is your own form and you can share it freely.
                </p>
              </div>
              <button onClick={() => setShowDuplicateBanner(false)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Meta card */}
          <div className="brutal p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={form.status} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {responseCount} {form.longitudinal ? "visit" : "response"}{responseCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    · {form.fields.length} fields
                  </span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Created {createdDate}
                </p>
              </div>
            </div>

            {form.description && (
              <p className="text-sm text-muted-foreground">{form.description}</p>
            )}

            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              {form.shared ? "Shared with you" : "You (owner)"}
            </div>
          </div>

          {/* Status control — owner only */}
          {!form.shared && (
            <div className="brutal p-4 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Form status</div>
              <div className="grid grid-cols-3 gap-2">
                {(["draft", "active", "closed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPendingStatus(s === currentStatus ? null : s)}
                    disabled={statusSaving}
                    className={`border-2 border-border py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                      selectedStatus === s ? "bg-primary" : "bg-card hover:bg-primary/30"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground">
                {selectedStatus === "draft" && "Draft — fill link shows 'not published'. Use for testing."}
                {selectedStatus === "active" && "Active — anyone with the link can submit responses."}
                {selectedStatus === "closed" && "Closed — new responses are blocked. Existing data is preserved."}
              </p>
              {pendingStatus && pendingStatus !== currentStatus && (
                <button
                  onClick={saveStatus}
                  disabled={statusSaving}
                  className="btn-brutal w-full text-xs disabled:opacity-60"
                >
                  {statusSaving ? "Saving…" : `Save — set to ${pendingStatus}`}
                </button>
              )}
              {statusError && (
                <p className="text-[9px] text-destructive font-bold">{statusError}</p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/forms/$id/fill"
              params={{ id: form.id }}
              className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
            >
              <Edit2 className="h-4 w-4" /> Fill form
            </Link>
            {/* Share — owners always, shared+canEdit users can sub-share to their team */}
            {(!form.shared || form.canEdit) && (
              <button
                onClick={() => setShowShare(true)}
                className="brutal relative flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
              >
                <Share2 className="h-4 w-4" />
                {form.shared ? "Manage team" : "Share"}
                {pendingRequestCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-destructive text-[9px] font-black text-destructive-foreground">
                    {pendingRequestCount}
                  </span>
                )}
              </button>
            )}

            {/* Responses — owners + view-permission users */}
            {(!form.shared || form.canView || form.canEdit) && (
              <Link
                to="/forms/$id/responses"
                params={{ id: form.id }}
                className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
              >
                <List className="h-4 w-4" /> Responses
              </Link>
            )}

            {/* Edit + Duplicate — owner only */}
            {!form.shared && (
              <button
                onClick={handleDuplicate}
                className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
              >
                <Copy className="h-4 w-4" /> Duplicate
              </button>
            )}

            {/* Edit form — owners + canEdit */}
            {(!form.shared || form.canEdit) && (
              <Link
                to="/forms/new"
                search={{ edit: form.id }}
                className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
              >
                <Edit2 className="h-4 w-4" /> Edit form
              </Link>
            )}
            <Link
              to="/analytics/$id"
              params={{ id: form.id }}
              className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
            >
              <BarChart2 className="h-4 w-4" /> Analytics
            </Link>

            {/* Install as desktop/home screen app */}
            {installed ? (
              <div className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider bg-primary/20 opacity-60 cursor-default">
                <Smartphone className="h-4 w-4" /> Installed ✓
              </div>
            ) : installPrompt ? (
              <button
                onClick={() => void handleInstall()}
                className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30 bg-primary/10"
              >
                <Smartphone className="h-4 w-4" /> Install app
              </button>
            ) : (
              <button
                onClick={() => setShowInstallHelp(true)}
                className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                title="Save as desktop icon"
              >
                <Smartphone className="h-4 w-4" /> Add to home
              </button>
            )}
          </div>

          {/* Longitudinal tab bar */}
          {form?.longitudinal && (
            <div className="flex border-b-2 border-border">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider border-r-2 border-border ${activeTab === 'overview' ? 'bg-primary' : 'bg-card hover:bg-muted'}`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('longitudinal')}
                className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${activeTab === 'longitudinal' ? 'bg-primary' : 'bg-card hover:bg-muted'}`}
              >
                Tracking Data
                {longitudinalSubs.length > 0 && (
                  <span className="ml-1.5 border border-border bg-card px-1 py-0.5 text-[9px] font-black">
                    {longitudinalSubs.length} subject{longitudinalSubs.length !== 1 ? "s" : ""}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Longitudinal data view */}
          {activeTab === 'longitudinal' && form?.longitudinal && (
            <div className="pb-4 space-y-3">
              {longitudinalSubs.length === 0 ? (
                <div className="brutal p-6 space-y-3">
                  <div className="text-sm font-bold uppercase tracking-wider">No tracking data yet</div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Share the fill link with data collectors. Each submission from the same subject
                    (identified by fixed fields) is grouped as a new visit automatically.
                  </p>
                  {!form.shared && (
                    <button
                      onClick={() => setShowShare(true)}
                      className="flex items-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30"
                    >
                      Get fill link →
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="border-2 border-border bg-card p-3 text-center">
                      <div className="font-display text-2xl leading-none">{longitudinalSubs.length}</div>
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Subjects</div>
                    </div>
                    <div className="border-2 border-border bg-card p-3 text-center">
                      <div className="font-display text-2xl leading-none">
                        {longitudinalSubs.reduce((n, s) => n + s.visits.length, 0)}
                      </div>
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Total visits</div>
                    </div>
                    <div className="border-2 border-border bg-card p-3 text-center">
                      <div className="font-display text-2xl leading-none">
                        {Math.max(...longitudinalSubs.map(s => s.visits.length), 0)}
                      </div>
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Max visits</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Fixed columns identify the subject · Visit columns track change over time
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        import('@/lib/longitudinalExport').then(m => m.exportLongitudinalCSV(longitudinalSubs, form!));
                      }}
                      className="shrink-0 border-2 border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                    >
                      Export CSV ↓
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse min-w-max">
                      <thead>
                        <tr className="border-b-2 border-border bg-muted">
                          {(form?.fields.filter(f => f.longitudinalRole === 'fixed' && f.type !== 'section_header') ?? []).map(f => (
                            <th key={f.id} className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[10px] border-r border-border whitespace-nowrap">
                              {f.label}
                              <span className="ml-1 text-[8px] font-black text-muted-foreground">(fixed)</span>
                            </th>
                          ))}
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[10px] border-r border-border whitespace-nowrap">Visits</th>
                          {(() => {
                            const maxVisits = Math.max(...longitudinalSubs.map(s => s.visits.length), 0);
                            const trackedFields = form?.fields.filter(f => f.longitudinalRole !== 'fixed' && f.type !== 'section_header' && f.type !== 'page_break') ?? [];
                            return Array.from({ length: maxVisits }, (_, i) =>
                              trackedFields.map(f => (
                                <th key={`${f.id}_v${i+1}`} className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[10px] border-r border-border whitespace-nowrap">
                                  {f.label} V{i+1}
                                </th>
                              ))
                            );
                          })()}
                        </tr>
                      </thead>
                      <tbody>
                        {longitudinalSubs.map((sub, ri) => {
                          const fixedFields = form?.fields.filter(f => f.longitudinalRole === 'fixed' && f.type !== 'section_header') ?? [];
                          const trackedFields = form?.fields.filter(f => f.longitudinalRole !== 'fixed' && f.type !== 'section_header' && f.type !== 'page_break') ?? [];
                          const maxVisits = Math.max(...longitudinalSubs.map(s => s.visits.length), 0);
                          return (
                            <tr key={sub.id} className={ri % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                              {fixedFields.map(f => (
                                <td key={f.id} className="px-3 py-2 font-bold border-r border-border whitespace-nowrap">{fmtCellVal(sub.fixedData[f.id])}</td>
                              ))}
                              <td className="px-3 py-2 border-r border-border text-center font-bold">{sub.visits.length}</td>
                              {Array.from({ length: maxVisits }, (_, i) =>
                                trackedFields.map(f => (
                                  <td key={`${f.id}_v${i+1}`} className="px-3 py-2 border-r border-border whitespace-nowrap">
                                    {sub.visits[i] ? (
                                      <>
                                        <span>{fmtCellVal(sub.visits[i].data[f.id])}</span>
                                        <div className="text-[9px] text-muted-foreground mt-0.5">
                                          {new Date(sub.visits[i].timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                        </div>
                                      </>
                                    ) : '—'}
                                  </td>
                                ))
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Danger zone — owner only */}
          {!form.shared && <div className="brutal border-destructive p-4 space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
            </div>
            {deleteStep === 0 ? (
              <button
                onClick={() => setDeleteStep(1)}
                className="flex items-center gap-2 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete form
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
                  This will delete the form and all {responseCount} response{responseCount !== 1 ? "s" : ""} permanently.
                  Type <strong>{form.name}</strong> to confirm.
                </p>
                <input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="input-brutal text-sm"
                  placeholder={form.name}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDeleteStep(0); setDeleteConfirmText(""); }}
                    className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteConfirmText !== form.name}
                    className="flex-1 border-2 border-destructive bg-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground disabled:opacity-40"
                  >
                    Delete forever
                  </button>
                </div>
              </div>
            )}
          </div>}
        </div>
      </PageShell>

      {/* Share modal — owner or can_edit user (mini-admin of their team) */}
      {/* Install help modal — shown when browser doesn't support auto-prompt (iOS/Firefox) */}
      {showInstallHelp && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowInstallHelp(false)}>
          <div className="w-full max-w-sm border-4 border-border bg-background p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-display text-base uppercase">Add to home screen</div>
              <button onClick={() => setShowInstallHelp(false)} className="border border-border p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-2 border-border p-3 flex items-center gap-3">
              <img src={`${API_BASE}/api/forms/${form.id}/icon.svg`} className="h-12 w-12 border border-border" alt="icon" />
              <div>
                <div className="font-bold text-sm">{form.name}</div>
                <div className="text-[10px] text-muted-foreground">research.vyasaa.com</div>
              </div>
            </div>
            <div className="space-y-2 text-[11px]">
              <p className="font-bold uppercase tracking-wider">On Android (Chrome):</p>
              <p className="text-muted-foreground">Tap ⋮ menu → <strong>Add to Home screen</strong> → Add</p>
              <p className="font-bold uppercase tracking-wider mt-3">On iPhone (Safari):</p>
              <p className="text-muted-foreground">Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> → Add</p>
              <p className="font-bold uppercase tracking-wider mt-3">On Desktop (Chrome):</p>
              <p className="text-muted-foreground">Click the <strong>install icon</strong> (⊕) in the address bar</p>
            </div>
            <p className="text-[10px] text-muted-foreground border-t border-border pt-3">
              The icon opens directly to this form — fill, responses, analytics in one tap.
            </p>
          </div>
        </div>
      )}

      {showShare && (!form.shared || form.canEdit) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowShare(false)}>
          <div className="w-full max-w-md border-4 border-border bg-background max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-border p-4">
              <div className="font-display text-base uppercase">Share form</div>
              <button onClick={() => setShowShare(false)} className="border border-border p-1.5 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-5">

              {/* ── Access requests — always visible at top when share token exists ── */}
              {form.shareToken && (
                <div className="border-2 border-primary/40 bg-primary/5 rounded-sm">
                  <PendingRequestsPanel formId={form.id} />
                </div>
              )}

              {/* ── Link access toggle ── */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Fill link access</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex cursor-pointer items-center gap-2 border-2 p-3 transition-colors ${(form.isPublic ?? true) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                    <input type="radio" name={`vis-${form.id}`} checked={form.isPublic ?? true} onChange={() => store.updateForm(form.id, { isPublic: true })} className="shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold uppercase flex items-center gap-1"><Globe className="h-3 w-3" /> Public</div>
                      <div className="text-[9px] text-muted-foreground">Anyone with the link</div>
                    </div>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 border-2 p-3 transition-colors ${!(form.isPublic ?? true) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                    <input type="radio" name={`vis-${form.id}`} checked={!(form.isPublic ?? true)} onChange={() => store.updateForm(form.id, { isPublic: false })} className="shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold uppercase flex items-center gap-1"><Lock className="h-3 w-3" /> Private</div>
                      <div className="text-[9px] text-muted-foreground">Added people only</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* ── Fill link ── */}
              <div className="space-y-2">
                {fillLink ? (
                  <>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{fillLink}</code>
                      <button onClick={() => copyToClipboard(fillLink, "fill")} className="btn-brutal shrink-0 text-[10px]">
                        {copied === "fill" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "Copy"}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <a href={`https://wa.me/?text=${encodeURIComponent(`Hi! Please fill this form for the *${form.name}* study.\n\nFill here: ${fillLink}\n\nNo login required.`)}`} target="_blank" rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30">
                        <ExternalLink className="h-3 w-3" /> WhatsApp
                      </a>
                      <button disabled={tokenWorking === "fill"} onClick={() => void handleRevokeToken("fill")}
                        className="flex items-center gap-1.5 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-40">
                        {tokenWorking === "fill" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />} Revoke
                      </button>
                    </div>
                  </>
                ) : (
                  <button disabled={tokenWorking === "fill"} onClick={() => void handleGenerateToken("fill")}
                    className="flex w-full items-center justify-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-40">
                    {tokenWorking === "fill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Generate fill link
                  </button>
                )}
                {tokenMsg && <p className={`text-[10px] font-bold ${tokenMsg.ok ? "text-primary" : "text-destructive"}`}>{tokenMsg.text}</p>}
              </div>

              {/* ── People with access ── */}
              <div className="border-t-2 border-border pt-4 space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">People with access</div>
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  Add anyone by email. They can fill via the link. Registered users also get it in their account.
                </p>

                {/* Email + role input */}
                <div className="space-y-2">
                  <input type="email" placeholder="user@example.com" value={accessEmail}
                    onChange={(e) => { setAccessEmail(e.target.value); setInviteMsg(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddAccess(); } }}
                    className="input-brutal w-full text-sm" />
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["fill", "fill-view", "admin"] as const).map((role) => {
                      const labels = { fill: "Fill only", "fill-view": "Fill + View", admin: "Team admin" };
                      const descs = { fill: "Enters data", "fill-view": "Enters + sees all data", admin: "Can share further" };
                      return (
                        <button key={role} onClick={() => setAccessRole(role)}
                          className={`border-2 px-2 py-2 text-left transition-colors ${accessRole === role ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                          <div className="text-[9px] font-bold uppercase tracking-wider">{labels[role]}</div>
                          <div className="text-[8px] text-muted-foreground mt-0.5">{descs[role]}</div>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => void handleAddAccess()} disabled={inviteWorking}
                    className="flex w-full items-center justify-center gap-2 btn-brutal text-[10px] py-2 disabled:opacity-40">
                    {inviteWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add person
                  </button>
                  {inviteMsg && <p className={`text-[10px] font-bold ${inviteMsg.ok ? "text-primary" : "text-destructive"}`}>{inviteMsg.text}</p>}
                </div>

                {/* Combined people list */}
                {(() => {
                  const allEmails = form.allowedFillerEmails ?? [];
                  const shareEmails = new Set(shares.map((s) => s.email.toLowerCase()));
                  const fillerOnly = allEmails.filter((e) => !shareEmails.has(e.toLowerCase()));
                  const hasAnyone = shares.length > 0 || fillerOnly.length > 0;
                  if (!hasAnyone && !sharesLoading) return null;
                  return (
                    <div className="space-y-1">
                      {sharesLoading && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
                      {shares.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 border border-border px-3 py-2">
                          <span className="flex-1 text-[11px] font-mono truncate">{s.email}</span>
                          <div className="flex gap-1">
                            {s.canEdit ? <span className="border border-primary px-1.5 py-0.5 text-[8px] font-bold uppercase bg-primary/10">Admin</span>
                              : s.canView ? <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase">Fill+View</span>
                              : <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase">Fill</span>}
                          </div>
                          <button onClick={() => void handleRemoveAccess(s.email, s.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      {fillerOnly.map((email) => (
                        <div key={email} className="flex items-center gap-2 border border-border px-3 py-2 opacity-80">
                          <span className="flex-1 text-[11px] font-mono truncate">{email}</span>
                          <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase text-muted-foreground">Link only</span>
                          <button onClick={() => void handleRemoveAccess(email)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── Analytics link ── */}
              <div className="border-t-2 border-border pt-4 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <BarChart2 className="h-3.5 w-3.5" /> Analytics link (read-only, no login)
                </div>
                {analyticsLink ? (
                  <>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{analyticsLink}</code>
                      <button onClick={() => copyToClipboard(analyticsLink, "analytics")} className="btn-brutal shrink-0 text-[10px]">
                        {copied === "analytics" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "Copy"}
                      </button>
                    </div>
                    <button disabled={tokenWorking === "analytics"} onClick={() => void handleRevokeToken("analytics")}
                      className="flex items-center gap-1.5 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-40">
                      {tokenWorking === "analytics" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />} Revoke
                    </button>
                  </>
                ) : (
                  <button disabled={tokenWorking === "analytics"} onClick={() => void handleGenerateToken("analytics")}
                    className="flex w-full items-center justify-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-40">
                    {tokenWorking === "analytics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Generate analytics link
                  </button>
                )}
              </div>

              {/* access requests panel moved to top of modal */}

              {/* ── Transfer ownership ── */}
              <div className="border-t-2 border-border pt-5 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Transfer ownership</div>
                {transferStep === 0 ? (
                  <>
                    <input
                      type="email"
                      placeholder="New owner email"
                      value={transferEmail}
                      onChange={(e) => { setTransferEmail(e.target.value); setTransferMsg(""); }}
                      className="input-brutal w-full text-sm"
                    />
                    <button
                      onClick={() => {
                        if (!transferEmail.includes("@")) { setTransferMsg("Enter a valid email."); return; }
                        setTransferStep(1);
                        setTransferMsg("");
                      }}
                      className="w-full border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                    >
                      Transfer to {transferEmail || "…"}
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
                      Transfer "{form.name}" to {transferEmail}? You become a viewer and cannot undo this.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setTransferStep(0); setTransferMsg(""); }}
                        className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          const tok = getToken();
                          if (!tok) { setTransferMsg("Not authenticated."); return; }
                          try {
                            const res = await fetch(`${API_BASE}/api/forms/transfer`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                              body: JSON.stringify({ form_id: form.id, new_owner_email: transferEmail }),
                            });
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({ detail: "Transfer failed" }));
                              setTransferMsg(body.detail ?? "Transfer failed");
                              setTransferStep(0);
                            } else {
                              setShowShare(false);
                              nav({ to: "/forms" });
                            }
                          } catch {
                            setTransferMsg("Transfer failed. Check your connection.");
                            setTransferStep(0);
                          }
                        }}
                        className="flex-1 border-2 border-destructive bg-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground"
                      >
                        Confirm transfer
                      </button>
                    </div>
                  </div>
                )}
                {transferMsg && <p className="text-[10px] text-destructive font-bold">{transferMsg}</p>}
              </div>
            </div>

            <div className="border-t-2 border-border p-4">
              <button onClick={() => setShowShare(false)} className="btn-brutal w-full">Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
