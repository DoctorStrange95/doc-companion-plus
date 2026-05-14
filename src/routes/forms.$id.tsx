import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useStore, store, sync } from "@/lib/store";
import { getToken, API_BASE } from "@/lib/api";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  Edit2, Copy, Trash2, ExternalLink, BarChart2,
  Share2, X, CheckCircle2, AlertTriangle,
  User, Globe, List, ArrowRight, Link2, Link2Off, Loader2, Lock, Plus,
} from "lucide-react";

interface FormShareEntry {
  id: string;
  email: string;
  canFill: boolean;
  canView: boolean;
  canEdit: boolean;
}

export const Route = createFileRoute("/forms/$id")({ component: FormsIdLayout });

/** Layout wrapper — renders FormDetail when at /forms/:id exactly, child route otherwise. */
function FormsIdLayout() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isIndex = pathname === `/forms/${id}` || pathname === `/forms/${id}/`;
  return isIndex ? <FormDetail /> : <Outlet />;
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

  const [showShare, setShowShare] = useState(false);
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePerms, setInvitePerms] = useState({ fill: true, view: true, edit: false });
  const [inviteWorking, setInviteWorking] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [fillerEmailInput, setFillerEmailInput] = useState("");
  const [tokenWorking, setTokenWorking] = useState<"fill" | "analytics" | null>(null);
  const [tokenMsg, setTokenMsg] = useState<{ text: string; ok: boolean } | null>(null);


  const formId = form?.id;

  // When the share modal opens: drain the queue so any pending form ops reach the DB
  useEffect(() => {
    if (showShare) void sync.drain();
  }, [showShare]);

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
        await sync.pushForm(form);
        res = await doGenerate();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed" }));
        setTokenMsg({ text: body.detail ?? "Failed to generate link", ok: false });
        return;
      }
      const { token } = await res.json() as { token: string };
      store.updateForm(form.id, type === "fill" ? { shareToken: token } : { analyticsToken: token });
    } catch {
      setTokenMsg({ text: "Network error — check your connection.", ok: false });
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
    } catch {
      setTokenMsg({ text: "Network error — check your connection.", ok: false });
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

  const responseCount = submissions.length;
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
    store.updateForm(form!.id, { status: pendingStatus });
    const updated = store.get().forms.find((f) => f.id === form!.id);
    if (updated) {
      void sync.pushForm(updated)
        .then(() => { setPendingStatus(null); })
        .catch(() => { setStatusError("Could not reach server. Status saved locally and will sync automatically."); })
        .finally(() => setStatusSaving(false));
    } else {
      setStatusSaving(false);
    }
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
          (!form.shared || form.canEdit) ? (
            <Link
              to="/forms/new"
              search={{ edit: form.id }}
              className="btn-brutal inline-flex items-center gap-1.5 text-xs"
            >
              <Edit2 className="h-3.5 w-3.5" /> Edit
            </Link>
          ) : undefined
        }
      />

      <PageShell>
        <div className="space-y-4">
          {/* Meta card */}
          <div className="brutal p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={form.status} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {responseCount} response{responseCount !== 1 ? "s" : ""}
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
            {form.shared ? (
              <>
                <Link
                  to="/forms/$id/responses"
                  params={{ id: form.id }}
                  className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                >
                  <List className="h-4 w-4" /> Responses
                </Link>
                {form.canEdit && (
                  <Link
                    to="/forms/new"
                    search={{ edit: form.id }}
                    className="brutal col-span-2 flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                  >
                    <Edit2 className="h-4 w-4" /> Edit form
                  </Link>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowShare(true)}
                  className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                >
                  <Share2 className="h-4 w-4" /> Share
                </button>
                <Link
                  to="/forms/$id/responses"
                  params={{ id: form.id }}
                  className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                >
                  <List className="h-4 w-4" /> Responses
                </Link>
                <button
                  onClick={handleDuplicate}
                  className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
                >
                  <Copy className="h-4 w-4" /> Duplicate
                </button>
              </>
            )}
            <Link
              to="/analytics/$id"
              params={{ id: form.id }}
              className="brutal col-span-2 flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
            >
              <BarChart2 className="h-4 w-4" /> Analytics
            </Link>
          </div>

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

      {/* Share modal — owner only */}
      {showShare && !form.shared && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowShare(false)}>
          <div className="w-full max-w-md border-4 border-border bg-background max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-border p-4">
              <div className="font-display text-base uppercase">Share form</div>
              <button onClick={() => setShowShare(false)} className="border border-border p-1.5 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-6">

              {/* ── Section 1: Who can fill? ── */}
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-border text-[10px] font-black">1</span>
                  Who can fill this form?
                </div>

                {/* Radio options */}
                <div className="space-y-2">
                  <label className={`flex cursor-pointer items-start gap-3 border-2 p-3 transition-colors ${(form.isPublic ?? true) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                    <input
                      type="radio"
                      name={`vis-${form.id}`}
                      checked={form.isPublic ?? true}
                      onChange={() => store.updateForm(form.id, { isPublic: true })}
                      className="mt-0.5 shrink-0"
                    />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Globe className="h-3 w-3" /> Anyone with the link
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">No login or email required — open access.</div>
                    </div>
                  </label>
                  <label className={`flex cursor-pointer items-start gap-3 border-2 p-3 transition-colors ${!(form.isPublic ?? true) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                    <input
                      type="radio"
                      name={`vis-${form.id}`}
                      checked={!(form.isPublic ?? true)}
                      onChange={() => store.updateForm(form.id, { isPublic: false })}
                      className="mt-0.5 shrink-0"
                    />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Lock className="h-3 w-3" /> Only specific people
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Fillers verify their email at the gate before accessing.</div>
                    </div>
                  </label>
                </div>

                {/* Allowed filler emails (private mode only) */}
                {!(form.isPublic ?? true) && (
                  <div className="space-y-2 pl-3 border-l-2 border-border">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Allowed filler emails</div>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        placeholder="collector@example.com"
                        value={fillerEmailInput}
                        onChange={(e) => setFillerEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const trimmed = fillerEmailInput.trim();
                            if (!trimmed.includes("@")) return;
                            const current = form.allowedFillerEmails ?? [];
                            if (current.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return;
                            store.updateForm(form.id, { allowedFillerEmails: [...current, trimmed] });
                            setFillerEmailInput("");
                          }
                        }}
                        className="input-brutal flex-1 text-sm"
                      />
                      <button
                        onClick={() => {
                          const trimmed = fillerEmailInput.trim();
                          if (!trimmed.includes("@")) return;
                          const current = form.allowedFillerEmails ?? [];
                          if (current.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return;
                          store.updateForm(form.id, { allowedFillerEmails: [...current, trimmed] });
                          setFillerEmailInput("");
                        }}
                        className="btn-brutal shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {(form.allowedFillerEmails ?? []).length > 0 ? (
                      <div className="space-y-1">
                        {(form.allowedFillerEmails ?? []).map((email) => (
                          <div key={email} className="flex items-center gap-2 border border-border px-3 py-2">
                            <span className="flex-1 text-[11px] font-mono truncate">{email}</span>
                            <button
                              onClick={() => store.updateForm(form.id, { allowedFillerEmails: (form.allowedFillerEmails ?? []).filter((e) => e !== email) })}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">No fillers yet — add emails above.</p>
                    )}
                  </div>
                )}

                {/* Fill link */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Fill link
                  </div>
                  {fillLink ? (
                    <>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{fillLink}</code>
                        <button onClick={() => copyToClipboard(fillLink, "fill")} className="btn-brutal shrink-0 text-[10px]">
                          {copied === "fill" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "Copy"}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`Hi! Please fill this form for the *${form.name}* study.\n\nFill here: ${fillLink}\n\nNo login required.`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-1.5 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30"
                        >
                          <ExternalLink className="h-3 w-3" /> WhatsApp
                        </a>
                        <button
                          disabled={tokenWorking === "fill"}
                          onClick={() => void handleRevokeToken("fill")}
                          className="flex items-center gap-1.5 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-40"
                        >
                          {tokenWorking === "fill" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />} Revoke
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      disabled={tokenWorking === "fill"}
                      onClick={() => void handleGenerateToken("fill")}
                      className="flex w-full items-center justify-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-40"
                    >
                      {tokenWorking === "fill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Generate fill link
                    </button>
                  )}
                  {tokenMsg && (
                    <p className={`text-[10px] font-bold ${tokenMsg.ok ? "text-primary" : "text-destructive"}`}>{tokenMsg.text}</p>
                  )}
                </div>
              </div>

              {/* ── Section 2: Who can see responses & analytics? ── */}
              <div className="border-t-2 border-border pt-5 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-border text-[10px] font-black">2</span>
                  Who can see responses & analytics?
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Add registered users who can view, fill, or edit this form in their account.
                </p>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteMsg(null); }}
                  className="input-brutal w-full text-sm"
                />
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Permissions:</span>
                  {(["fill", "view", "edit"] as const).map((p) => {
                    const labels = { fill: "Enter data", view: "See data", edit: "Edit form" };
                    return (
                      <label key={p} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={invitePerms[p]}
                          onChange={(e) => setInvitePerms((prev) => ({ ...prev, [p]: e.target.checked }))}
                        />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{labels[p]}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  onClick={handleInvite}
                  disabled={inviteWorking}
                  className="flex w-full items-center justify-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-40"
                >
                  {inviteWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Add collaborator
                </button>
                {inviteMsg && (
                  <p className={`text-[10px] font-bold ${inviteMsg.ok ? "text-primary" : "text-destructive"}`}>{inviteMsg.text}</p>
                )}
                {sharesLoading ? (
                  <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : shares.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Shared with</div>
                    {shares.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 border border-border px-3 py-2">
                        <span className="flex-1 text-[11px] font-mono truncate">{s.email}</span>
                        <div className="flex gap-1">
                          {s.canFill && <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest">Fill</span>}
                          {s.canView && <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest">View</span>}
                          {s.canEdit && <span className="border border-border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest">Edit</span>}
                        </div>
                        <button onClick={() => handleRemoveShare(s.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Analytics link */}
                <div className="space-y-2 border-t border-border pt-3">
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
                      <button
                        disabled={tokenWorking === "analytics"}
                        onClick={() => void handleRevokeToken("analytics")}
                        className="flex items-center gap-1.5 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      >
                        {tokenWorking === "analytics" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />} Revoke
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={tokenWorking === "analytics"}
                      onClick={() => void handleGenerateToken("analytics")}
                      className="flex w-full items-center justify-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-40"
                    >
                      {tokenWorking === "analytics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Generate analytics link
                    </button>
                  )}
                </div>
              </div>

              {/* ── Section 3: Transfer ownership ── */}
              <div className="border-t-2 border-border pt-5 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center border-2 border-border text-[10px] font-black">3</span>
                  Transfer ownership
                </div>
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
