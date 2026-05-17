import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useStore, store, sync } from "@/lib/store";
import type { Submission, FormField } from "@/lib/store";
import type { LongitudinalSubmission } from "@/types/longitudinal";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Trash2, X, Download, AlertTriangle, User, FileJson, RefreshCw, BarChart2, Image, FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/forms/$id/responses")({ component: FormResponses });

// ─── Formatting helpers ──────────────────────────────────────────────────────

interface FileUploadValue { name: string; size: number; type: string; data: string; }

function isFileUpload(val: unknown): val is FileUploadValue {
  return typeof val === "object" && val !== null && "data" in val && "name" in val;
}

function formatCellValue(val: unknown, field: FormField): string {
  if (val === undefined || val === null || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) return val.join(" | ");
  if (typeof val === "object") {
    const o = val as Record<string, unknown>;
    if ("systolic" in o) return `${o.systolic}/${o.diastolic} mmHg`;
    if ("lat" in o) return `${(o.lat as number).toFixed(4)}, ${(o.lng as number).toFixed(4)}`;
    if (isFileUpload(val)) return val.name;
    return JSON.stringify(val);
  }
  if (field.type === "photo") return "📷 photo";
  if (field.type === "yes_no" || field.type === "boolean") {
    return String(val) === "true" ? "Yes" : String(val) === "false" ? "No" : String(val);
  }
  return String(val);
}

function downloadFile(file: FileUploadValue) {
  const a = document.createElement("a");
  a.href = file.data;
  a.download = file.name;
  a.click();
}

function DetailFieldValue({ field, val }: { field: FormField; val: unknown }) {
  if (val === undefined || val === null || val === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field.type === "photo" && typeof val === "string" && val.startsWith("data:")) {
    return (
      <div className="mt-1 space-y-2">
        <img src={val} alt="Uploaded photo" className="max-h-64 w-full border-2 border-border object-contain" />
        <a
          href={val}
          download="photo.jpg"
          className="inline-flex items-center gap-1.5 border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20"
        >
          <Download className="h-3 w-3" /> Download photo
        </a>
      </div>
    );
  }
  if (field.type === "file_upload" && isFileUpload(val)) {
    const sizeLabel = val.size > 1024 * 1024
      ? `${(val.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(val.size / 1024).toFixed(0)} KB`;
    return (
      <div className="mt-1 flex items-center gap-3 border-2 border-border px-3 py-2.5">
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold">{val.name}</div>
          <div className="text-[10px] text-muted-foreground">{sizeLabel}</div>
        </div>
        <button
          onClick={() => downloadFile(val)}
          className="shrink-0 flex items-center gap-1.5 border-2 border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/20"
        >
          <Download className="h-3 w-3" /> Download
        </button>
      </div>
    );
  }
  const text = formatCellValue(val, field);
  return <span className={text === "—" ? "text-muted-foreground" : ""}>{text}</span>;
}

function getRespondentLabel(sub: Submission): string {
  const name = sub.data["__respondent_name"];
  const email = sub.data["__respondent_email"];
  const code = sub.data["__respondent_id"];
  if (name) return String(name);
  if (email) return String(email);
  if (code) return `Code: ${code}`;
  if (sub.patientId) return `Patient #${sub.patientId.slice(-6)}`;
  return "Anonymous";
}

// ─── CSV / JSON export ───────────────────────────────────────────────────────

function exportCsv(submissions: Submission[], fields: FormField[], formName: string) {
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "photo" && f.type !== "file_upload");
  const headers = ["#", "Date", "Respondent Name", "Respondent Email", "Respondent ID",
    ...dataFields.map((f) => f.variableName ?? f.label)];

  const rows = submissions.map((sub, i) => [
    submissions.length - i,
    new Date(sub.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
    sub.data["__respondent_name"] ?? "",
    sub.data["__respondent_email"] ?? "",
    sub.data["__respondent_id"] ?? "",
    ...dataFields.map((f) => {
      const v = sub.data[f.id];
      if (v === undefined || v === null) return "";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (Array.isArray(v)) return v.join(" | ");
      if ((f.type === "yes_no" || f.type === "boolean") && typeof v === "string") {
        return v === "true" ? "Yes" : v === "false" ? "No" : v;
      }
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }),
  ]);

  const csvLines = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","),
  );
  // UTF-8 BOM + Windows CRLF so Excel reads correctly
  const BOM = "﻿";
  const blob = new Blob([BOM + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-zA-Z0-9]/g, "_")}_responses.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson(submissions: Submission[], fields: FormField[], formName: string) {
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");
  const payload = {
    form: formName,
    exported_at: new Date().toISOString(),
    fields: dataFields.map((f) => ({ id: f.id, label: f.label, type: f.type, variable: f.variableName })),
    responses: submissions.map((sub, i) => ({
      index: submissions.length - i,
      date: new Date(sub.createdAt).toISOString(),
      respondent: getRespondentLabel(sub),
      data: Object.fromEntries(dataFields.map((f) => [f.variableName ?? f.label, sub.data[f.id] ?? null])),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-zA-Z0-9]/g, "_")}_responses.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Detail modal ────────────────────────────────────────────────────────────

function DetailModal({ sub, fields, onClose, onDelete, canDelete }: {
  sub: Submission; fields: FormField[]; onClose: () => void; onDelete: () => void; canDelete: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const respondent = getRespondentLabel(sub);
  const date = new Date(sub.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break" && f.type !== "calculated");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg border-4 border-border bg-background max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-border p-4">
          <div>
            <div className="font-display text-base uppercase flex items-center gap-2">
              <User className="h-4 w-4" /> {respondent}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{date}</div>
          </div>
          <button onClick={onClose} className="border border-border p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="divide-y divide-border px-4">
          {dataFields.map((f) => (
            <div key={f.id} className="py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{f.label}</div>
              <div className="mt-0.5 text-sm">
                <DetailFieldValue field={f} val={sub.data[f.id]} />
              </div>
            </div>
          ))}
        </div>
        {canDelete && (
          <div className="border-t-2 border-border p-4">
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="flex w-full items-center justify-center gap-2 border-2 border-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground">
                <Trash2 className="h-3.5 w-3.5" /> Delete this response
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> This will permanently delete this response.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 border-2 border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-muted">Cancel</button>
                  <button onClick={onDelete} className="flex-1 border-2 border-destructive bg-destructive px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-destructive-foreground">Delete forever</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Spreadsheet table ───────────────────────────────────────────────────────

function DataTable({ submissions, fields, onRowClick }: {
  submissions: Submission[];
  fields: FormField[];
  onRowClick: (sub: Submission) => void;
}) {
  const dataFields = fields.filter((f) => f.type !== "section_header" && f.type !== "page_break");

  if (submissions.length === 0) {
    return (
      <div className="brutal-flat p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No responses yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-2 border-border" style={{ maxHeight: "calc(100vh - 220px)" }}>
      <table className="min-w-full border-collapse text-[12px] whitespace-nowrap">
        <thead className="bg-[#171e19] text-white" style={{ position: "sticky", top: 0, zIndex: 2 }}>
          <tr>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[36px]">#</th>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[80px]">Date</th>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[60px]">Time</th>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[150px]">Respondent Email</th>
            {dataFields.map((f) => (
              <th key={f.id} className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[90px] max-w-[160px]" title={f.label}>
                <div className="truncate">{f.variableName ?? (f.label.length > 14 ? f.label.slice(0, 14) + "…" : f.label)}</div>
                <div className="font-normal text-[9px] opacity-50 normal-case tracking-normal">{f.type}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {submissions.map((sub, i) => (
            <tr
              key={sub.id}
              className="cursor-pointer border-b border-border hover:bg-primary/10 transition-colors"
              style={{ background: i % 2 === 0 ? "var(--background)" : "var(--muted)" }}
              onClick={() => onRowClick(sub)}
            >
              <td className="px-3 py-2 border-r border-border text-muted-foreground font-mono text-[10px]">{submissions.length - i}</td>
              <td className="px-3 py-2 border-r border-border text-[11px] whitespace-nowrap">
                {new Date(sub.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
              </td>
              <td className="px-3 py-2 border-r border-border text-[11px] font-mono whitespace-nowrap">
                {new Date(sub.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="px-3 py-2 border-r border-border text-[11px] max-w-[160px] truncate">
                {(sub.data["__respondent_email"] as string | undefined) || <span className="text-muted-foreground">—</span>}
              </td>
              {dataFields.map((f) => {
                const val = sub.data[f.id];
                if (f.type === "photo") {
                  const hasPhoto = typeof val === "string" && val.startsWith("data:");
                  return (
                    <td key={f.id} className="px-3 py-2 border-r border-border text-[11px] max-w-[160px]">
                      {hasPhoto
                        ? <span className="flex items-center gap-1 text-primary font-bold"><Image className="h-3 w-3" /> photo</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                }
                if (f.type === "file_upload") {
                  const hasFile = isFileUpload(val);
                  return (
                    <td key={f.id} className="px-3 py-2 border-r border-border text-[11px] max-w-[160px] truncate">
                      {hasFile
                        ? <span className="flex items-center gap-1 font-bold" title={(val as FileUploadValue).name}><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{(val as FileUploadValue).name}</span></span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                }
                const display = formatCellValue(val, f);
                return (
                  <td key={f.id} className="px-3 py-2 border-r border-border text-[11px] max-w-[160px] truncate" title={display !== "—" ? display : undefined}>
                    {display === "—" ? <span className="text-muted-foreground">—</span> : display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Longitudinal subject table ───────────────────────────────────────────────

function LongitudinalTable({
  subjects,
  fields,
  fixedFieldIds,
  onRowClick,
}: {
  subjects: LongitudinalSubmission[];
  fields: FormField[];
  fixedFieldIds: string[];
  onRowClick: (sub: LongitudinalSubmission) => void;
}) {
  const fixedFields = fields.filter(
    (f) => fixedFieldIds.includes(f.id) && f.type !== "section_header" && f.type !== "page_break",
  );

  if (subjects.length === 0) {
    return (
      <div className="brutal-flat p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No subjects tracked yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-2 border-border" style={{ maxHeight: "calc(100vh - 220px)" }}>
      <table className="min-w-full border-collapse text-[12px] whitespace-nowrap">
        <thead className="bg-[#171e19] text-white" style={{ position: "sticky", top: 0, zIndex: 2 }}>
          <tr>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[36px]">#</th>
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[90px]">Last visit</th>
            {fixedFields.map((f) => (
              <th key={f.id} className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[100px] max-w-[160px]" title={f.label}>
                <div className="truncate">{f.variableName ?? (f.label.length > 14 ? f.label.slice(0, 14) + "…" : f.label)}</div>
                <div className="font-normal text-[9px] opacity-50 normal-case tracking-normal">{f.type}</div>
              </th>
            ))}
            <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px] border-r border-white/10 min-w-[80px] bg-primary/20">Tracked</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((sub, i) => {
            const lastVisit = sub.visits[sub.visits.length - 1];
            const lastTs = lastVisit ? new Date(lastVisit.timestamp) : new Date(sub.updatedAt);
            return (
              <tr
                key={sub.id}
                className="cursor-pointer border-b border-border hover:bg-primary/10 transition-colors"
                style={{ background: i % 2 === 0 ? "var(--background)" : "var(--muted)" }}
                onClick={() => onRowClick(sub)}
              >
                <td className="px-3 py-2 border-r border-border text-muted-foreground font-mono text-[10px]">{subjects.length - i}</td>
                <td className="px-3 py-2 border-r border-border text-[11px] whitespace-nowrap">
                  {lastTs.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                </td>
                {fixedFields.map((f) => {
                  const display = formatCellValue(sub.fixedData[f.id], f);
                  return (
                    <td key={f.id} className="px-3 py-2 border-r border-border text-[11px] max-w-[160px] truncate" title={display !== "—" ? display : undefined}>
                      {display === "—" ? <span className="text-muted-foreground">—</span> : display}
                    </td>
                  );
                })}
                <td className="px-3 py-2 border-r border-border text-[11px] font-bold bg-primary/5">
                  <span className="inline-flex items-center gap-1.5 border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-black tracking-widest">
                    {sub.visits.length}×
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LongitudinalDetailModal({
  sub,
  fields,
  fixedFieldIds,
  onClose,
}: {
  sub: LongitudinalSubmission;
  fields: FormField[];
  fixedFieldIds: string[];
  onClose: () => void;
}) {
  const fixedFields = fields.filter((f) => fixedFieldIds.includes(f.id) && f.type !== "section_header" && f.type !== "page_break");
  const visitFields = fields.filter((f) => !fixedFieldIds.includes(f.id) && f.type !== "section_header" && f.type !== "page_break" && f.type !== "calculated");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg border-4 border-border bg-background max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Subject header */}
        <div className="flex items-start justify-between border-b-2 border-border p-4">
          <div>
            <div className="font-display text-base uppercase flex items-center gap-2">
              <User className="h-4 w-4" />
              {fixedFields.map((f) => sub.fixedData[f.id]).filter(Boolean).join(" · ") || "Subject"}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">
              {sub.visits.length} visit{sub.visits.length !== 1 ? "s" : ""} tracked
            </div>
          </div>
          <button onClick={onClose} className="border border-border p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Fixed fields summary */}
        <div className="border-b-2 border-border px-4 py-3 bg-muted/40">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Subject info</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {fixedFields.map((f) => (
              <div key={f.id}>
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{f.label}</div>
                <div className="text-[11px]">
                  <DetailFieldValue field={f} val={sub.fixedData[f.id]} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Visit timeline */}
        <div className="px-4 py-3">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Visit history</div>
          <div className="space-y-3">
            {[...sub.visits].reverse().map((visit, idx) => {
              const visitDate = new Date(visit.timestamp);
              return (
                <div key={visit.visitId} className="border-2 border-border">
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      Visit {sub.visits.length - idx}
                    </span>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {visitDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {" · "}
                      {visitDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2">
                    {visitFields.map((f) => (
                      <div key={f.id}>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{f.label}</div>
                        <div className="text-[11px]">
                          <DetailFieldValue field={f} val={visit.data[f.id]} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

function FormResponses() {
  const { id } = Route.useParams();
  const form = useStore((s) => s.forms.find((f) => f.id === id));
  const rawSubmissions = useStore((s) => s.submissions);
  const rawLongitudinal = useStore((s) => s.longitudinalSubmissions);
  const isOwner = !form?.shared;
  const [selected, setSelected] = useState<Submission | null>(null);
  const [selectedLong, setSelectedLong] = useState<LongitudinalSubmission | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(true);

  const longitudinalSubjects = useMemo(
    () => rawLongitudinal.filter((s) => s.formId === id).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [rawLongitudinal, id],
  );

  const submissions = useMemo(() => {
    if (form?.longitudinal) return [];
    return rawSubmissions.filter((s) => s.formId === id).sort((a, b) => b.createdAt - a.createdAt);
  }, [rawSubmissions, id, form?.longitudinal]);

  // Pull on mount — show local data immediately, merge server data in background.
  useEffect(() => {
    setSyncing(true);
    void sync.pull().finally(() => setSyncing(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await sync.pull();
    setRefreshing(false);
  };

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
        subtitle={
          form.longitudinal
            ? `${longitudinalSubjects.length} subject${longitudinalSubjects.length !== 1 ? "s" : ""} · ${form.name}`
            : `${submissions.length} response${submissions.length !== 1 ? "s" : ""} · ${form.name}`
        }
        back={`/forms/${id}`}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRefresh}
              disabled={refreshing || syncing}
              className="border-2 border-border bg-card p-1.5 hover:bg-muted disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${(refreshing || syncing) ? "animate-spin" : ""}`} />
            </button>
            <Link
              to="/analytics/$id"
              params={{ id: form.id }}
              className="border-2 border-border bg-card p-1.5 hover:bg-muted"
              title="View analytics"
            >
              <BarChart2 className="h-3.5 w-3.5" />
            </Link>
            {isOwner && submissions.length > 0 && !form.longitudinal && (
              <>
                <button
                  onClick={() => exportCsv(submissions, form.fields, form.name)}
                  className="btn-brutal inline-flex items-center gap-1 text-[10px]"
                  title="Download CSV"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                <button
                  onClick={() => exportJson(submissions, form.fields, form.name)}
                  className="btn-brutal inline-flex items-center gap-1 text-[10px]"
                  title="Download JSON"
                >
                  <FileJson className="h-3 w-3" /> JSON
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="px-4 pb-24 pt-2">
        {form.longitudinal ? (
          syncing && longitudinalSubjects.length === 0 ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs font-bold uppercase tracking-widest">Loading subjects…</span>
            </div>
          ) : (
            <LongitudinalTable
              subjects={longitudinalSubjects}
              fields={form.fields}
              fixedFieldIds={form.fixedFieldIds ?? []}
              onRowClick={setSelectedLong}
            />
          )
        ) : submissions.length === 0 ? (
          syncing ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs font-bold uppercase tracking-widest">Loading responses…</span>
            </div>
          ) : (
            <div className="brutal-flat p-8 text-center mt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">No responses yet</p>
              <Link to="/forms/$id/fill" params={{ id: form.id }} className="btn-brutal mt-4 inline-block text-xs">
                Fill first response
              </Link>
            </div>
          )
        ) : (
          <DataTable submissions={submissions} fields={form.fields} onRowClick={setSelected} />
        )}
      </div>

      {selected && (
        <DetailModal
          sub={selected}
          fields={form.fields}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected)}
          canDelete={isOwner}
        />
      )}

      {selectedLong && (
        <LongitudinalDetailModal
          sub={selectedLong}
          fields={form.fields}
          fixedFieldIds={form.fixedFieldIds ?? []}
          onClose={() => setSelectedLong(null)}
        />
      )}
    </>
  );
}
