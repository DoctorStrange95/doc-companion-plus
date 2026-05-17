import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore, type FormField } from "@/lib/store";
import { Printer } from "lucide-react";

export const Route = createFileRoute("/forms/$id/print")({ component: PrintFormPage });

function getOpts(f: FormField): string[] {
  if (f.optionObjects && f.optionObjects.length > 0) return f.optionObjects.map((o) => o.label);
  return f.options ?? [];
}

function PrintField({ field, qNum }: { field: FormField; qNum: number }) {
  if (field.type === "page_break") {
    return <div style={{ pageBreakAfter: "always", height: 0 }} />;
  }

  if (field.type === "section_header") {
    return (
      <div style={{ marginTop: 20, marginBottom: 6, borderBottom: "1.5px solid #222", paddingBottom: 3 }}>
        <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>
          {field.label}
        </span>
        {field.hint && <div style={{ fontWeight: 400, fontSize: 10, color: "#666", marginTop: 2 }}>{field.hint}</div>}
      </div>
    );
  }

  const isConditional = !!field.showIf || !!field.visibleIf;

  return (
    <div style={{ marginBottom: 14, breakInside: "avoid" }}>
      {/* Question label */}
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 11, minWidth: 18, color: "#111" }}>{qNum}.</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 11, color: "#111" }}>{field.label}</span>
          {field.required && <span style={{ color: "#c00", marginLeft: 2 }}>*</span>}
          {field.unit && <span style={{ fontWeight: 400, fontSize: 10, color: "#555", marginLeft: 4 }}>({field.unit})</span>}
          {isConditional && <span style={{ fontWeight: 400, fontSize: 9, color: "#888", marginLeft: 6, fontStyle: "italic" }}>(if applicable)</span>}
        </div>
      </div>

      {/* Hint */}
      {field.hint && (
        <div style={{ marginLeft: 24, marginBottom: 3, fontSize: 9, color: "#666", fontStyle: "italic" }}>{field.hint}</div>
      )}

      {/* Input representation */}
      <div style={{ marginLeft: 24 }}>
        <FieldInputPrint field={field} />
      </div>
    </div>
  );
}

function FieldInputPrint({ field }: { field: FormField }) {
  const opts = getOpts(field);
  const LINE = <div style={{ borderBottom: "1px solid #333", width: 260, height: 18, display: "inline-block" }} />;

  switch (field.type) {
    case "short_text": case "text":
      return LINE;

    case "long_text": case "textarea":
      return (
        <div style={{ border: "1px solid #333", width: "100%", maxWidth: 440, height: 48, display: "block" }} />
      );

    case "number":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {LINE}
          {field.unit && <span style={{ fontSize: 10, color: "#555" }}>{field.unit}</span>}
        </div>
      );

    case "date":
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {["DD", "MM", "YYYY"].map((p) => (
            <span key={p} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <div style={{ borderBottom: "1px solid #333", width: p === "YYYY" ? 44 : 28, height: 16 }} />
              <span style={{ fontSize: 8, color: "#888" }}>{p}</span>
            </span>
          ))}
        </div>
      );

    case "time":
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {["HH", "MM"].map((p) => (
            <span key={p} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <div style={{ borderBottom: "1px solid #333", width: 28, height: 16 }} />
              <span style={{ fontSize: 8, color: "#888" }}>{p}</span>
            </span>
          ))}
        </div>
      );

    case "datetime":
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {["DD", "MM", "YYYY", "HH", "MM"].map((p, i) => (
            <span key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <div style={{ borderBottom: "1px solid #333", width: p === "YYYY" ? 44 : 28, height: 16 }} />
              <span style={{ fontSize: 8, color: "#888" }}>{p}</span>
            </span>
          ))}
        </div>
      );

    case "yes_no": case "boolean":
      return (
        <div style={{ display: "flex", gap: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <Circle /> Yes
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <Circle /> No
          </label>
        </div>
      );

    case "select_one": case "radio": case "select":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px" }}>
          {opts.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <Circle /> {o}
            </label>
          ))}
          {field.includeOther && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <Circle /> Other: <div style={{ borderBottom: "1px solid #333", width: 80, height: 14, display: "inline-block", marginLeft: 4 }} />
            </label>
          )}
        </div>
      );

    case "select_many": case "multiselect":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px" }}>
          {opts.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <Square /> {o}
            </label>
          ))}
          {field.includeOther && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <Square /> Other: <div style={{ borderBottom: "1px solid #333", width: 80, height: 14, display: "inline-block", marginLeft: 4 }} />
            </label>
          )}
        </div>
      );

    case "rating":
      return (
        <div style={{ display: "flex", gap: 12 }}>
          {Array.from({ length: field.maxRating ?? 5 }, (_, i) => (
            <label key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 10 }}>
              <Circle />
              <span>{i + 1}</span>
            </label>
          ))}
        </div>
      );

    case "slider":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
          <span>{field.sliderMin ?? 0}</span>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: 11 }, (_, i) => (
              <Circle key={i} size={9} />
            ))}
          </div>
          <span>{field.sliderMax ?? 10}</span>
        </div>
      );

    case "measurement":
      if (field.measurementType === "BP") {
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{ borderBottom: "1px solid #333", width: 60, height: 16 }} />
            <span>/</span>
            <div style={{ borderBottom: "1px solid #333", width: 60, height: 16 }} />
            <span style={{ fontSize: 10, color: "#555" }}>mmHg</span>
          </div>
        );
      }
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ borderBottom: "1px solid #333", width: 120, height: 16 }} />
          {(field.unit ?? field.measurementType) && (
            <span style={{ fontSize: 10, color: "#555" }}>{field.unit ?? field.measurementType}</span>
          )}
        </div>
      );

    case "matrix": {
      const rows = field.matrixRows ?? [];
      const cols = field.matrixColumns ?? [];
      if (rows.length === 0 || cols.length === 0) return null;
      return (
        <table style={{ borderCollapse: "collapse", fontSize: 10, marginTop: 4 }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #aaa", padding: "3px 8px", minWidth: 80 }} />
              {cols.map((c) => (
                <th key={c} style={{ border: "1px solid #aaa", padding: "3px 8px", fontWeight: 600 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td style={{ border: "1px solid #aaa", padding: "3px 8px", fontWeight: 600 }}>{r}</td>
                {cols.map((c) => (
                  <td key={c} style={{ border: "1px solid #aaa", padding: "4px 12px", textAlign: "center" }}>
                    <Circle />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case "location":
      return (
        <div style={{ fontSize: 10, color: "#666" }}>
          Lat: <div style={{ borderBottom: "1px solid #333", width: 80, display: "inline-block", height: 14, marginRight: 12 }} />
          Lng: <div style={{ borderBottom: "1px solid #333", width: 80, display: "inline-block", height: 14 }} />
        </div>
      );

    case "photo": case "file_upload":
      return (
        <div style={{ border: "1px dashed #aaa", width: 120, height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase" }}>
            {field.type === "photo" ? "Photo" : "File"}
          </span>
        </div>
      );

    case "calculated":
      return <div style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>Calculated automatically</div>;

    default:
      return LINE;
  }
}

function Circle({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <circle cx="5" cy="5" r="4" fill="none" stroke="#333" strokeWidth="1.2" />
    </svg>
  );
}

function Square({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect x="1" y="1" width="8" height="8" fill="none" stroke="#333" strokeWidth="1.2" />
    </svg>
  );
}

function PrintFormPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const form = useStore((s) => s.forms.find((f) => f.id === id));

  useEffect(() => {
    // Auto-print when the page is ready
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  if (!form) {
    return (
      <div style={{ padding: 32, fontFamily: "sans-serif" }}>
        Form not found. <button onClick={() => nav({ to: "/forms" })}>Back to forms</button>
      </div>
    );
  }

  const visibleFields = form.fields.filter((f) => f.type !== "calculated");
  let qNum = 0;

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          @page { margin: 18mm 15mm; size: A4 portrait; }
        }
        body { font-family: Arial, sans-serif; background: #fff; }
        .print-page { max-width: 680px; margin: 0 auto; padding: 24px 20px; }
      `}</style>

      {/* Toolbar — hidden when printing */}
      <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#f5f5f0", borderBottom: "2px solid #000", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 100 }}>
        <button
          onClick={() => nav({ to: "/forms/$id", params: { id } })}
          style={{ border: "2px solid #000", background: "#fff", padding: "4px 12px", fontWeight: 700, fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
        >
          ← Back
        </button>
        <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{form.name}</span>
        <button
          onClick={() => window.print()}
          style={{ border: "2px solid #000", background: "#000", color: "#fff", padding: "4px 14px", fontWeight: 700, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: 1 }}
        >
          <Printer size={14} /> Print / Save PDF
        </button>
      </div>

      {/* Printable content */}
      <div className="print-page" style={{ paddingTop: 64 }}>

        {/* Page header — shown when printing */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2, fontSize: 9, color: "#666" }}>
          <span>{today}</span>
          <span>{form.name}</span>
        </div>
        <hr style={{ border: "none", borderTop: "1px solid #333", marginBottom: 10 }} />

        {/* Form title */}
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1 style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>{form.name}</h1>
          <p style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
            {form.category}{form.description ? ` · ${form.description}` : ""}
          </p>
        </div>

        {/* Fields */}
        {visibleFields.map((f) => {
          if (f.type !== "section_header" && f.type !== "page_break") qNum++;
          return <PrintField key={f.id} field={f} qNum={qNum} />;
        })}

        {/* Footer */}
        <hr style={{ border: "none", borderTop: "1px solid #ccc", marginTop: 24, marginBottom: 6 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#aaa" }}>
          <span>Generated by CommunityMed Pro</span>
          <span>{today}</span>
        </div>
      </div>
    </>
  );
}
