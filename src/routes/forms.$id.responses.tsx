import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useStore, store } from "@/lib/store";
import type { Submission, FormField } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Trash2, X, Download, ChevronRight, AlertTriangle, User, FileJson } from "lucide-react";

export const Route = createFileRoute("/forms/$id/responses")({ component: FormResponses });

function formatValue(field: FormField, val: unknown): string {
  if (val === undefined || val === null || val === "") return "—";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "object" && val !== null) {
    const o = val as Record<string, unknown>;
    if ("systolic" in o) return `${o.systolic}/${o.diastolic} mmHg`;
    if ("lat" in o) return `${(o.lat as number).toFixed(4)}, ${(o.lng as number).toFixed(4)}`;
    if ("value" in o && "unit" in o) return `${o.value} ${o.unit}`;
    return JSON.stringify(val);
  }
  if (field.type === "rating" || field.type === "slider") return String(val);
  return String(val);
}

function getRespondentLabel(sub: Submission): string {
  const name = sub.data["__respondent_name"];
  const email = sub.data["__respondent_email"];
  const code = sub.data["__respondent_id"];
  if (name) return String(name);
  if (email) return String(email);
  if (code) return `Code: ${code}`;
  if (sub.patientId && sub.patientId !== "") return `Patient #${sub.patientId.slice(-6)}`;
  return "Anonymous";
}

function previewData(sub: Submission, fields: FormField[]): string {
  const visible = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "calculated");
  const parts: string[] = [];
  for (const f of visible.slice(0, 3)) {
    const v = sub.data[f.id];
    if (v !== undefined && v !== null && v !== "") {
      parts.push(`${f.label}: ${formatValue(f, v)}`);
    }
  }
  return parts.join(" · ") || "No data";
}

function exportCsv(submissions: Submission[], fields: FormField[], formName: string) {
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");
  const headers = ["#", "Date", "Respondent", ...dataFields.map((f) => f.label)];
  const rows = submissions.map((sub, i) => {
    const date = new Date(sub.createdAt).toLocaleDateString("en-GB");
    const respondent = getRespondentLabel(sub);
    const values = dataFields.map((f) => {
      const v = formatValue(f, sub.data[f.id]);
      return `"${v.replace(/"/g, '""')}"`;
    });
    return [String(i + 1), date, `"${respondent}"`, ...values].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-z0-9]/gi, "_")}_responses.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson(submissions: Submission[], fields: FormField[], formName: string) {
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");
  const payload = {
    form: formName,
    exported_at: new Date().toISOString(),
    fields: dataFields.map((f) => ({ id: f.id, label: f.label, type: f.type })),
    responses: submissions.map((sub, i) => ({
      index: i + 1,
      date: new Date(sub.createdAt).toISOString(),
      respondent: getRespondentLabel(sub),
      data: Object.fromEntries(dataFields.map((f) => [f.label, sub.data[f.id] ?? null])),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-z0-9]/gi, "_")}_responses.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface DetailModalProps {
  sub: Submission;
  fields: FormField[];
  onClose: () => void;
  onDelete: () => void;
}

function DetailModal({ sub, fields, onClose, onDelete }: DetailModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const respondent = getRespondentLabel(sub);
  const date = new Date(sub.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "calculated");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-lg border-4 border-border bg-background max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-border p-4">
          <div>
            <div className="font-display text-base uppercase flex items-center gap-2">
              <User className="h-4 w-4" /> {respondent}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{date}</div>
          </div>
          <button onClick={onClose} className="border border-border p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divide-y divide-border p-4 space-y-0">
          {dataFields.map((f) => {
            const v = sub.data[f.id];
            const display = formatValue(f, v);
            return (
              <div key={f.id} className="py-2.5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{f.label}</div>
                <div className={`mt-0.5 text-sm ${display === "—" ? "text-muted-foreground" : ""}`}>{display}</div>
              </div>
            );
          })}
        </div>

        <div className="border-t-2 border-border p-4 space-y-2">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-center gap-2 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete this response
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> This will permanently delete this response.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={onDelete}
                  className="flex-1 border-2 border-destructive bg-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground"
                >
                  Delete forever
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FormResponses() {
  const { id } = Route.useParams();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const rawSubmissions = useStore((s) => s.submissions);

  const submissions = useMemo(
    () => rawSubmissions.filter((s) => s.formId === id).sort((a, b) => b.createdAt - a.createdAt),
    [rawSubmissions, id],
  );

  const [selected, setSelected] = useState<Submission | null>(null);

  const handleDelete = (sub: Submission) => {
    store.deleteSubmission(sub.id);
    setSelected(null);
  };

  if (!form) {
    return (
      <>
        <PageHeader title="Responses" back={`/forms/${id}`} />
        <PageShell>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Form not found</p>
        </PageShell>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Responses"
        subtitle={`${submissions.length} response${submissions.length !== 1 ? "s" : ""} · ${form.name}`}
        back={`/forms/${id}`}
        action={
          submissions.length > 0 ? (
            <div className="flex gap-1.5">
              <button
                onClick={() => exportCsv(submissions, form.fields, form.name)}
                className="btn-brutal inline-flex items-center gap-1 text-xs"
                title="Download CSV"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                onClick={() => exportJson(submissions, form.fields, form.name)}
                className="btn-brutal inline-flex items-center gap-1 text-xs"
                title="Download JSON"
              >
                <FileJson className="h-3.5 w-3.5" /> JSON
              </button>
            </div>
          ) : undefined
        }
      />
      <PageShell>
        {submissions.length === 0 ? (
          <div className="brutal-flat p-8 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No responses yet</p>
            <Link
              to="/forms/$id/fill"
              params={{ id: form.id }}
              className="btn-brutal mt-4 inline-block text-xs"
            >
              Fill first response
            </Link>
          </div>
        ) : (
          <ul className="grid gap-2">
            {submissions.map((sub, i) => {
              const respondent = getRespondentLabel(sub);
              const date = new Date(sub.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              const preview = previewData(sub, form.fields);
              return (
                <li key={sub.id}>
                  <button
                    onClick={() => setSelected(sub)}
                    className="brutal w-full text-left flex items-start gap-3 p-4 hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border bg-muted text-[10px] font-bold">
                      {submissions.length - i}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display text-sm uppercase">{respondent}</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{date}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{preview}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-1" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PageShell>

      {selected && (
        <DetailModal
          sub={selected}
          fields={form.fields}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected)}
        />
      )}
    </>
  );
}
