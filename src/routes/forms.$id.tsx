import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, store } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import {
  Edit2, Copy, Trash2, ExternalLink, BarChart2,
  Share2, X, CheckCircle2, AlertTriangle,
  User, Globe, List, ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/forms/$id")({ component: FormDetail });

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
  const submissions = useStore((s) => s.submissions.filter((s) => s.formId === id));

  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState<"fill" | "analytics" | null>(null);
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferStep, setTransferStep] = useState(0);
  const [transferMsg, setTransferMsg] = useState("");

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

  const handleStatusChange = (newStatus: "draft" | "active" | "closed") => {
    setStatusSaving(true);
    store.updateForm(form.id, { status: newStatus });
    setTimeout(() => setStatusSaving(false), 300);
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
          <Link
            to="/forms/new"
            search={{ edit: form.id }}
            className="btn-brutal inline-flex items-center gap-1.5 text-xs"
          >
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </Link>
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

            {/* Owner */}
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              {form.shared ? "Shared with you" : "You (owner)"}
            </div>
          </div>

          {/* Status control */}
          <div className="brutal p-4 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Form status</div>
            <div className="grid grid-cols-3 gap-2">
              {(["draft", "active", "closed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  disabled={statusSaving}
                  className={`border-2 border-border py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                    (form.status ?? "active") === s ? "bg-primary" : "bg-card hover:bg-primary/30"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground">
              {form.status === "draft" && "Draft — fill link shows 'not published'. Use for testing."}
              {(form.status === "active" || !form.status) && "Active — anyone with the link can submit responses."}
              {form.status === "closed" && "Closed — new responses are blocked. Existing data is preserved."}
            </p>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/forms/$id/fill"
              params={{ id: form.id }}
              className="brutal flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
            >
              <Edit2 className="h-4 w-4" /> Fill form
            </Link>
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
            <Link
              to="/analytics/$id"
              params={{ id: form.id }}
              className="brutal col-span-2 flex items-center justify-center gap-2 p-3 text-xs font-bold uppercase tracking-wider hover:bg-primary/30"
            >
              <BarChart2 className="h-4 w-4" /> Analytics
            </Link>
          </div>

          {/* Share links */}
          {fillLink && (
            <div className="brutal p-4 space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Globe className="h-3.5 w-3.5" /> Public fill link
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{fillLink}</code>
                <button
                  onClick={() => copyToClipboard(fillLink, "fill")}
                  className="btn-brutal shrink-0 text-[10px]"
                >
                  {copied === "fill" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "Copy"}
                </button>
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hi! Please fill this form.\n\nFill here: ${fillLink}\n\nNo login required.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Share on WhatsApp
              </a>
            </div>
          )}

          {analyticsLink && (
            <div className="brutal p-4 space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <BarChart2 className="h-3.5 w-3.5" /> Public analytics link
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{analyticsLink}</code>
                <button
                  onClick={() => copyToClipboard(analyticsLink, "analytics")}
                  className="btn-brutal shrink-0 text-[10px]"
                >
                  {copied === "analytics" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "Copy"}
                </button>
              </div>
            </div>
          )}

          {/* Danger zone */}
          <div className="brutal border-destructive p-4 space-y-3">
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
          </div>
        </div>
      </PageShell>

      {/* Share modal */}
      {showShare && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="w-full max-w-md border-4 border-border bg-background p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg uppercase">Share "{form.name}"</div>
              <button onClick={() => setShowShare(false)} className="border border-border p-1.5 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            {fillLink ? (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Public fill link</div>
                <p className="text-[11px] text-muted-foreground">Anyone with this link can fill the form — no login needed.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 text-[10px] font-mono">{fillLink}</code>
                  <button onClick={() => copyToClipboard(fillLink, "fill")} className="btn-brutal shrink-0 text-[10px]">
                    {copied === "fill" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hi! Please fill this form for the *${form.name}* study.\n\nFill here: ${fillLink}\n\nNo login required.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 w-full border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Share on WhatsApp
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No share link yet — save the form first.</p>
            )}

            {/* Transfer ownership — only for non-shared forms (i.e., you are the owner) */}
            {!form.shared && (
              <div className="border-t-2 border-border pt-4 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <ArrowRight className="h-3.5 w-3.5" /> Transfer ownership
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
                      Transfer "{form.name}" to {transferEmail}? You become a viewer. This cannot be undone without the new owner's action.
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
                          try {
                            const { api, getToken } = await import("@/lib/api");
                            const tok = getToken();
                            if (!tok) { setTransferMsg("Not authenticated."); return; }
                            const res = await fetch("/api/forms/transfer", {
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
            )}

            <button onClick={() => setShowShare(false)} className="btn-brutal w-full">
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
