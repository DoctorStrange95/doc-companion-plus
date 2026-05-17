import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useStore, store, sync } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Plus, FileText, Edit2, Share2, Copy, ChevronRight, Search, List, RefreshCw, AlertTriangle } from "lucide-react";
import { getFormColor } from "@/lib/formColor";

export const Route = createFileRoute("/forms/")({ component: FormsList });

function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "active";
  const styles: Record<string, string> = {
    active: "bg-primary text-primary-foreground",
    draft: "border border-muted-foreground text-muted-foreground",
    closed: "bg-destructive/20 text-destructive",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${styles[s] ?? "border border-muted-foreground text-muted-foreground"}`}>
      {s}
    </span>
  );
}

function FormsList() {
  const { user } = useAuth();
  const forms = useStore((s) => s.forms);
  const allSubmissions = useStore((s) => s.submissions);
  const allLongitudinalSubmissions = useStore((s) => s.longitudinalSubmissions);
  const lastSync = useStore((s) => s.lastSync);
  const planAlert = useStore((s) => s.planAlert);
  const submissions = user ? allSubmissions : [];
  const longitudinalSubmissions = user ? allLongitudinalSubmissions : [];
  const [searchQuery, setSearchQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  // Free plan: max 5 owned forms
  const ownedFormCount = user ? forms.filter((f) => f.ownerId === user.id).length : 0;
  const atFormLimit = user?.role !== "admin" && ownedFormCount >= 5;

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSynced(false);
    try {
      await sync.pull();
      setSynced(true);
      setTimeout(() => setSynced(false), 2500);
    } finally {
      setSyncing(false);
    }
  };


  const filteredForms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q),
    );
  }, [forms, searchQuery]);

  const countFor = (form: typeof forms[0]) => {
    if (form.longitudinal) {
      return longitudinalSubmissions.filter(s => s.formId === form.id).reduce((n, s) => n + s.visits.length, 0);
    }
    return submissions.filter((s) => s.formId === form.id).length;
  };

  return (
    <>
      <PageHeader
        title="Form library"
        subtitle={`${forms.length} form${forms.length !== 1 ? "s" : ""}${lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Sync with server"
              className={`btn-brutal inline-flex items-center gap-1.5 text-xs disabled:opacity-60 transition-colors ${synced ? "bg-green-400 border-green-600" : ""}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className="font-bold uppercase tracking-widest">
                {syncing ? "Syncing…" : synced ? "Synced ✓" : "Sync"}
              </span>
            </button>
            {atFormLimit ? (
              <button
                onClick={() => store.setPlanAlert("form_limit")}
                className="btn-brutal inline-flex items-center gap-1.5 text-xs bg-destructive/10 text-destructive border-destructive"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            ) : (
              <Link
                to="/forms/new"
                className="btn-brutal inline-flex items-center gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </Link>
            )}
          </div>
        }
      />
      <PageShell>
        {planAlert && (
          <div className="brutal mb-4 border-2 border-destructive bg-destructive/10 p-3 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                {planAlert === "form_limit"
                  ? "Free tier limit reached — max 5 forms. Upgrade to Pro or Max in Settings."
                  : "Monthly submission limit reached (500). Upgrade to Pro or Max in Settings."}
              </p>
            </div>
            <button onClick={() => store.clearPlanAlert()} className="shrink-0 text-destructive/70 hover:text-destructive text-xs font-bold uppercase tracking-widest">
              ✕
            </button>
          </div>
        )}
        {forms.length > 0 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search by name, category, or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-brutal w-full pl-8 text-sm"
            />
          </div>
        )}
        {forms.length === 0 ? (
          <div className="brutal-flat p-8 text-center">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No forms yet</p>
            <Link to="/forms/new" className="btn-brutal mt-4 inline-block text-xs">
              Create first form
            </Link>
          </div>
        ) : filteredForms.length === 0 ? (
          <div className="brutal-flat p-8 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No forms match "{searchQuery}"</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {filteredForms.map((f) => {
              const responses = countFor(f);
              return (
                <li key={f.id} className="brutal">
                  {/* Main clickable area → form detail page */}
                  <Link
                    to="/forms/$id"
                    params={{ id: f.id }}
                    className="flex items-start gap-3 p-4 hover:bg-primary/5 transition-colors"
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-border"
                      style={{ background: getFormColor(f.id) }}
                    >
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-base uppercase leading-tight">{f.name}</h3>
                        <StatusBadge status={f.status} />
                        {f.longitudinal && (
                          <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground border border-muted-foreground px-1 py-0.5">
                            longitudinal
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {f.category} · {f.fields.length} fields · {responses} {f.longitudinal ? "visit" : "response"}{responses !== 1 ? "s" : ""}
                      </p>
                      {f.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{f.description}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                        {f.shared ? "Shared with you" : "You (owner)"}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-1" />
                  </Link>

                  {/* Quick action row */}
                  <div className="flex border-t-2 border-border">
                    <Link
                      to="/forms/$id/fill"
                      params={{ id: f.id }}
                      className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20 border-r border-border"
                    >
                      <Edit2 className="h-3 w-3" /> Fill
                    </Link>
                    {f.shared ? (
                      <>
                        {f.canEdit && (
                          <Link
                            to="/forms/new"
                            search={{ edit: f.id }}
                            className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20 border-r border-border"
                          >
                            <Edit2 className="h-3 w-3" /> Edit
                          </Link>
                        )}
                        <Link
                          to="/forms/$id/responses"
                          params={{ id: f.id }}
                          className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20"
                        >
                          <List className="h-3 w-3" /> Responses
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          to="/forms/new"
                          search={{ edit: f.id }}
                          className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20 border-r border-border"
                        >
                          <Edit2 className="h-3 w-3" /> Edit
                        </Link>
                        <Link
                          to="/forms/$id/responses"
                          params={{ id: f.id }}
                          className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20 border-r border-border"
                        >
                          <List className="h-3 w-3" /> Responses
                        </Link>
                        <Link
                          to="/forms/$id"
                          params={{ id: f.id }}
                          className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20"
                        >
                          <Share2 className="h-3 w-3" /> Share
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PageShell>
    </>
  );
}
