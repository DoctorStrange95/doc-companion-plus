import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect } from "react";
import { z } from "zod";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  store, useStore,
  type FormField, type FieldType, type ChartType,
  type ConditionalLogic, type ConditionalOperator,
  ruleId,
} from "@/lib/store";
import { PageHeader } from "@/components/PageShell";
import {
  Type, AlignLeft, Hash, Calendar, Clock, CalendarDays,
  ListChecks, CheckSquare, ToggleLeft, Star,
  Minus, LayoutGrid, Calculator,
  Stethoscope, MapPin, Camera,
  SeparatorHorizontal, SquareSplitHorizontal,
  GripVertical, Trash2, Copy, GitBranch, Plus, Settings, ChevronRight, X,
  Repeat,
} from "lucide-react";

const searchSchema = z.object({ edit: z.string().optional() });

export const Route = createFileRoute("/forms/new")({
  component: FormBuilderPage,
  validateSearch: (s) => searchSchema.parse(s),
});

// ─── Helper fns ──────────────────────────────────────────────────────────────

const uid = () => `f_${Math.random().toString(36).slice(2, 9)}`;

const toVariableName = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 30) || "field";

const defaultChart = (type: FieldType): ChartType => {
  switch (type) {
    case "number": case "slider": case "measurement": case "calculated":
      return "histogram";
    case "select_one": case "select": case "radio": case "yes_no": case "boolean":
      return "pie";
    case "select_many": case "multiselect": case "rating":
      return "bar";
    default:
      return "none";
  }
};

// ─── Field palette definition ─────────────────────────────────────────────────

interface PaletteItem {
  type: FieldType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: "Basic",
    items: [
      { type: "short_text", label: "Short text", icon: Type },
      { type: "long_text", label: "Long text", icon: AlignLeft },
      { type: "number", label: "Number", icon: Hash },
      { type: "date", label: "Date", icon: Calendar },
      { type: "time", label: "Time", icon: Clock },
      { type: "datetime", label: "Date & time", icon: CalendarDays },
    ],
  },
  {
    group: "Choice",
    items: [
      { type: "select_one", label: "Select one", icon: ListChecks },
      { type: "select_many", label: "Select many", icon: CheckSquare },
      { type: "yes_no", label: "Yes / No", icon: ToggleLeft },
      { type: "rating", label: "Rating / Stars", icon: Star },
    ],
  },
  {
    group: "Advanced",
    items: [
      { type: "slider", label: "Slider / Scale", icon: Minus },
      { type: "matrix", label: "Matrix / Grid", icon: LayoutGrid },
      { type: "calculated", label: "Calculated", icon: Calculator },
    ],
  },
  {
    group: "Clinical",
    items: [
      { type: "measurement", label: "Measurement", icon: Stethoscope },
      { type: "location", label: "Location / GPS", icon: MapPin },
      { type: "photo", label: "Photo / Image", icon: Camera },
    ],
  },
  {
    group: "Layout",
    items: [
      { type: "section_header", label: "Section header", icon: SeparatorHorizontal },
      { type: "page_break", label: "Page break", icon: SquareSplitHorizontal },
    ],
  },
];

const PALETTE_FLAT = PALETTE.flatMap((g) => g.items);

function getPaletteItem(type: FieldType) {
  return PALETTE_FLAT.find((p) => p.type === type);
}

// ─── Default field factory ────────────────────────────────────────────────────

function makeField(type: FieldType): FormField {
  const base: FormField = {
    id: uid(),
    type,
    label: "Untitled question",
    required: false,
    variableName: "untitled_question",
    analyticsChart: defaultChart(type),
  };
  switch (type) {
    case "select_one": case "select": case "radio":
      return { ...base, options: ["Option 1", "Option 2"], displayAs: "radio" };
    case "select_many": case "multiselect":
      return { ...base, options: ["Option 1", "Option 2"] };
    case "slider":
      return { ...base, sliderMin: 0, sliderMax: 10, sliderStep: 1, showValue: true };
    case "rating":
      return { ...base, maxRating: 5, ratingType: "stars" };
    case "number":
      return { ...base, decimalPlaces: 1 };
    case "calculated":
      return { ...base, formula: "", decimalPlaces: 2 };
    case "matrix":
      return { ...base, matrixRows: ["Row 1", "Row 2"], matrixColumns: ["Agree", "Neutral", "Disagree"] };
    case "measurement":
      return { ...base, measurementType: "weight", unit: "kg" };
    case "section_header":
      return { ...base, label: "Section title", required: false };
    default:
      return base;
  }
}

// ─── Sortable field card ──────────────────────────────────────────────────────

function SortableFieldCard({
  field,
  selected,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const palette = getPaletteItem(field.type);
  const Icon = palette?.icon ?? Type;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`brutal group relative ${selected ? "ring-2 ring-secondary" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab touch-none text-muted-foreground opacity-40 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Icon + content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
            <Icon className="h-3 w-3" />
            {palette?.label ?? field.type}
          </div>
          <div className="text-sm font-bold leading-snug">
            {field.label || "Untitled question"}
            {field.required && <span className="ml-1 text-destructive">*</span>}
          </div>
          {field.hint && (
            <div className="mt-0.5 text-[11px] italic text-muted-foreground">{field.hint}</div>
          )}
          {/* Mini preview */}
          <FieldPreview field={field} />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="border border-border p-1 hover:bg-primary/30"
            title="Duplicate"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="border border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {field.showIf && (
        <div className="border-t border-border px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <GitBranch className="h-2.5 w-2.5" /> conditional
        </div>
      )}
    </div>
  );
}

function FieldPreview({ field }: { field: FormField }) {
  const cls = "mt-2 pointer-events-none select-none";
  switch (field.type) {
    case "short_text": case "text":
      return <div className={`${cls} input-brutal text-[11px] text-muted-foreground`}>Short answer text</div>;
    case "long_text": case "textarea":
      return <div className={`${cls} input-brutal text-[11px] text-muted-foreground h-10`}>Long answer text</div>;
    case "number":
      return <div className={`${cls} input-brutal text-[11px] text-muted-foreground`}>{field.unit ? `0 ${field.unit}` : "0"}</div>;
    case "date":
      return <div className={`${cls} input-brutal text-[11px] text-muted-foreground`}>DD/MM/YYYY</div>;
    case "time":
      return <div className={`${cls} input-brutal text-[11px] text-muted-foreground`}>HH:MM</div>;
    case "yes_no": case "boolean":
      return (
        <div className={`${cls} flex gap-2`}>
          <div className="border-2 border-border px-3 py-1 text-[10px] font-bold uppercase">Yes</div>
          <div className="border-2 border-border px-3 py-1 text-[10px] font-bold uppercase">No</div>
        </div>
      );
    case "select_one": case "select": case "radio": {
      const opts = field.options ?? field.optionObjects?.map((o) => o.label) ?? [];
      return (
        <div className={`${cls} flex flex-wrap gap-1`}>
          {opts.slice(0, 3).map((o) => (
            <div key={o} className="border-2 border-border px-2 py-0.5 text-[10px] font-bold">{o}</div>
          ))}
          {opts.length > 3 && <div className="text-[10px] text-muted-foreground self-center">+{opts.length - 3}</div>}
        </div>
      );
    }
    case "slider":
      return (
        <div className={`${cls} flex items-center gap-2`}>
          <span className="text-[9px] font-bold">{field.sliderMin ?? 0}</span>
          <div className="flex-1 h-1 bg-border rounded-full" />
          <span className="text-[9px] font-bold">{field.sliderMax ?? 10}</span>
        </div>
      );
    case "rating":
      return (
        <div className={`${cls} flex gap-0.5`}>
          {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => (
            <Star key={i} className="h-3.5 w-3.5 text-muted-foreground" />
          ))}
        </div>
      );
    case "measurement":
      return (
        <div className={`${cls} text-[10px] font-bold uppercase text-muted-foreground`}>
          {field.measurementType === "BP" ? "SBP / DBP mmHg" : `${field.measurementType ?? "custom"} ${field.unit ?? ""}`}
        </div>
      );
    case "section_header":
      return <div className={`${cls} border-t-2 border-border pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>— Section —</div>;
    case "page_break":
      return <div className={`${cls} border-t-2 border-dashed border-border pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>— Page break —</div>;
    default:
      return null;
  }
}

// ─── Field Config Panel ───────────────────────────────────────────────────────

function FieldConfigPanel({
  field,
  allFields,
  onChange,
  onClose,
}: {
  field: FormField;
  allFields: FormField[];
  onChange: (patch: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const palette = getPaletteItem(field.type);
  const Icon = palette?.icon ?? Type;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b-2 border-border p-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <Icon className="h-4 w-4" />
          {palette?.label ?? field.type}
        </div>
        <button onClick={onClose} className="border border-border p-1 hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* Label */}
        <ConfigField label="Question label *">
          <input
            value={field.label}
            onChange={(e) => {
              const label = e.target.value;
              onChange({ label, variableName: toVariableName(label) });
            }}
            className="input-brutal"
            placeholder="Enter your question"
          />
        </ConfigField>

        {/* Variable name */}
        {field.type !== "section_header" && field.type !== "page_break" && (
          <ConfigField label="Variable name" hint="Used as CSV column header">
            <input
              value={field.variableName ?? ""}
              onChange={(e) => onChange({ variableName: e.target.value.replace(/[^a-z0-9_]/g, "_").slice(0, 30) })}
              className="input-brutal font-mono text-xs"
              placeholder="variable_name"
            />
          </ConfigField>
        )}

        {/* Hint */}
        {field.type !== "section_header" && field.type !== "page_break" && (
          <ConfigField label="Hint text" hint="Helper text shown below the question">
            <input
              value={field.hint ?? ""}
              onChange={(e) => onChange({ hint: e.target.value })}
              className="input-brutal"
              placeholder="Optional hint"
            />
          </ConfigField>
        )}

        {/* Required */}
        {field.type !== "section_header" && field.type !== "page_break" && (
          <label className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-widest">
            Required
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
        )}

        {/* Type-specific config */}
        <TypeConfig field={field} onChange={onChange} />

        {/* Conditional logic */}
        {field.type !== "section_header" && field.type !== "page_break" && (
          <ConditionalConfig field={field} allFields={allFields} onChange={onChange} />
        )}

        {/* Analytics */}
        {field.type !== "section_header" && field.type !== "page_break" && (
          <ConfigField label="Analytics chart">
            <select
              value={field.analyticsChart ?? "auto"}
              onChange={(e) => onChange({ analyticsChart: e.target.value as ChartType })}
              className="input-brutal"
            >
              <option value="auto">Auto</option>
              <option value="histogram">Histogram</option>
              <option value="line">Line chart</option>
              <option value="bar">Bar chart</option>
              <option value="pie">Pie chart</option>
              <option value="donut">Donut chart</option>
              <option value="none">None (text list)</option>
            </select>
          </ConfigField>
        )}

        {/* Normal range for number-like fields */}
        {(field.type === "number" || field.type === "measurement" || field.type === "slider") && (
          <ConfigField label="Normal range" hint="Shown as reference band in charts">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Min"
                value={field.normalRange?.min ?? ""}
                onChange={(e) => onChange({ normalRange: { min: Number(e.target.value), max: field.normalRange?.max ?? 0 } })}
                className="input-brutal text-xs"
              />
              <input
                type="number"
                placeholder="Max"
                value={field.normalRange?.max ?? ""}
                onChange={(e) => onChange({ normalRange: { min: field.normalRange?.min ?? 0, max: Number(e.target.value) } })}
                className="input-brutal text-xs"
              />
            </div>
          </ConfigField>
        )}
      </div>
    </div>
  );
}

function TypeConfig({ field, onChange }: { field: FormField; onChange: (p: Partial<FormField>) => void }) {
  switch (field.type) {
    case "number":
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Number settings</div>
          <div className="grid grid-cols-3 gap-2">
            <ConfigField label="Unit">
              <input value={field.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="input-brutal text-xs" placeholder="kg, cm…" />
            </ConfigField>
            <ConfigField label="Min">
              <input type="number" value={field.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })} className="input-brutal text-xs" />
            </ConfigField>
            <ConfigField label="Max">
              <input type="number" value={field.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })} className="input-brutal text-xs" />
            </ConfigField>
          </div>
          <ConfigField label="Decimal places">
            <select value={field.decimalPlaces ?? 1} onChange={(e) => onChange({ decimalPlaces: Number(e.target.value) })} className="input-brutal text-xs">
              <option value={0}>Integer (0)</option>
              <option value={1}>1 decimal</option>
              <option value={2}>2 decimals</option>
              <option value={3}>3 decimals</option>
            </select>
          </ConfigField>
        </div>
      );

    case "select_one": case "select": case "radio": case "select_many": case "multiselect": {
      const isMany = field.type === "select_many" || field.type === "multiselect";
      const opts = field.options ?? [];
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Options</div>
          {opts.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={(e) => {
                  const next = [...opts];
                  next[i] = e.target.value;
                  onChange({ options: next });
                }}
                className="input-brutal flex-1 text-xs"
              />
              <button onClick={() => onChange({ options: opts.filter((_, j) => j !== i) })} className="border border-border p-1 hover:bg-destructive hover:text-destructive-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ options: [...opts, `Option ${opts.length + 1}`] })}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1 hover:bg-primary/30 w-full justify-center"
          >
            <Plus className="h-3 w-3" /> Add option
          </button>
          {!isMany && (
            <ConfigField label="Display as">
              <select value={field.displayAs ?? "radio"} onChange={(e) => onChange({ displayAs: e.target.value as "radio" | "dropdown" })} className="input-brutal text-xs">
                <option value="radio">Radio buttons</option>
                <option value="dropdown">Dropdown</option>
              </select>
            </ConfigField>
          )}
          <label className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
            Include "Other" option
            <input type="checkbox" checked={!!field.includeOther} onChange={(e) => onChange({ includeOther: e.target.checked })} className="h-3.5 w-3.5" />
          </label>
        </div>
      );
    }

    case "slider":
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Slider settings</div>
          <div className="grid grid-cols-3 gap-2">
            <ConfigField label="Min">
              <input type="number" value={field.sliderMin ?? 0} onChange={(e) => onChange({ sliderMin: Number(e.target.value) })} className="input-brutal text-xs" />
            </ConfigField>
            <ConfigField label="Max">
              <input type="number" value={field.sliderMax ?? 10} onChange={(e) => onChange({ sliderMax: Number(e.target.value) })} className="input-brutal text-xs" />
            </ConfigField>
            <ConfigField label="Step">
              <input type="number" value={field.sliderStep ?? 1} onChange={(e) => onChange({ sliderStep: Number(e.target.value) })} className="input-brutal text-xs" />
            </ConfigField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ConfigField label="Left label">
              <input value={field.leftLabel ?? ""} onChange={(e) => onChange({ leftLabel: e.target.value })} className="input-brutal text-xs" placeholder="None" />
            </ConfigField>
            <ConfigField label="Right label">
              <input value={field.rightLabel ?? ""} onChange={(e) => onChange({ rightLabel: e.target.value })} className="input-brutal text-xs" placeholder="Severe" />
            </ConfigField>
          </div>
          <label className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
            Show current value
            <input type="checkbox" checked={!!field.showValue} onChange={(e) => onChange({ showValue: e.target.checked })} className="h-3.5 w-3.5" />
          </label>
        </div>
      );

    case "rating":
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rating settings</div>
          <ConfigField label="Max rating">
            <select value={field.maxRating ?? 5} onChange={(e) => onChange({ maxRating: Number(e.target.value) })} className="input-brutal text-xs">
              <option value={5}>5 stars</option>
              <option value={7}>7</option>
              <option value={10}>10</option>
            </select>
          </ConfigField>
          <ConfigField label="Style">
            <select value={field.ratingType ?? "stars"} onChange={(e) => onChange({ ratingType: e.target.value as "stars" | "numbers" })} className="input-brutal text-xs">
              <option value="stars">Stars</option>
              <option value="numbers">Numbers</option>
            </select>
          </ConfigField>
        </div>
      );

    case "calculated":
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Formula</div>
          <ConfigField label="Formula" hint="Use {variableName} to reference fields. e.g. {weight} / ({height}/100)^2">
            <textarea
              value={field.formula ?? ""}
              onChange={(e) => onChange({ formula: e.target.value })}
              rows={3}
              className="input-brutal resize-none font-mono text-xs"
              placeholder="{weight} / ({height}/100)^2"
            />
          </ConfigField>
          <div className="grid grid-cols-2 gap-2">
            <ConfigField label="Unit">
              <input value={field.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="input-brutal text-xs" />
            </ConfigField>
            <ConfigField label="Decimal places">
              <select value={field.decimalPlaces ?? 2} onChange={(e) => onChange({ decimalPlaces: Number(e.target.value) })} className="input-brutal text-xs">
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </ConfigField>
          </div>
        </div>
      );

    case "matrix": {
      const rows = field.matrixRows ?? [];
      const cols = field.matrixColumns ?? [];
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Matrix settings</div>
          <ConfigField label="Rows (questions)">
            {rows.map((r, i) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input value={r} onChange={(e) => { const next = [...rows]; next[i] = e.target.value; onChange({ matrixRows: next }); }} className="input-brutal flex-1 text-xs" />
                <button onClick={() => onChange({ matrixRows: rows.filter((_, j) => j !== i) })} className="border border-border p-1 hover:bg-destructive hover:text-destructive-foreground"><X className="h-3 w-3" /></button>
              </div>
            ))}
            <button onClick={() => onChange({ matrixRows: [...rows, `Row ${rows.length + 1}`] })} className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1 hover:bg-primary/30 w-full justify-center">
              <Plus className="h-3 w-3" /> Add row
            </button>
          </ConfigField>
          <ConfigField label="Columns (scale)">
            {cols.map((c, i) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input value={c} onChange={(e) => { const next = [...cols]; next[i] = e.target.value; onChange({ matrixColumns: next }); }} className="input-brutal flex-1 text-xs" />
                <button onClick={() => onChange({ matrixColumns: cols.filter((_, j) => j !== i) })} className="border border-border p-1 hover:bg-destructive hover:text-destructive-foreground"><X className="h-3 w-3" /></button>
              </div>
            ))}
            <button onClick={() => onChange({ matrixColumns: [...cols, `Option ${cols.length + 1}`] })} className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1 hover:bg-primary/30 w-full justify-center">
              <Plus className="h-3 w-3" /> Add column
            </button>
          </ConfigField>
        </div>
      );
    }

    case "measurement":
      return (
        <div className="space-y-3 border-2 border-border p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Measurement preset</div>
          <ConfigField label="Type">
            <select
              value={field.measurementType ?? "custom"}
              onChange={(e) => {
                const t = e.target.value as FormField["measurementType"];
                const presets: Record<string, { unit: string; min?: number; max?: number }> = {
                  weight: { unit: "kg", min: 0.5, max: 300 },
                  height: { unit: "cm", min: 30, max: 250 },
                  BP: { unit: "mmHg" },
                  temperature: { unit: "°C", min: 30, max: 45 },
                  SpO2: { unit: "%", min: 50, max: 100 },
                  BSL: { unit: "mg/dL", min: 20, max: 600 },
                  MUAC: { unit: "cm", min: 5, max: 40 },
                  custom: { unit: "" },
                };
                const p = presets[t ?? "custom"] ?? { unit: "" };
                onChange({ measurementType: t, ...p });
              }}
              className="input-brutal text-xs"
            >
              <option value="weight">Weight (kg)</option>
              <option value="height">Height (cm)</option>
              <option value="BP">Blood pressure (BP)</option>
              <option value="temperature">Temperature</option>
              <option value="SpO2">SpO2</option>
              <option value="BSL">Blood sugar (BSL)</option>
              <option value="MUAC">MUAC</option>
              <option value="custom">Custom</option>
            </select>
          </ConfigField>
          {field.measurementType === "custom" && (
            <ConfigField label="Unit">
              <input value={field.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} className="input-brutal text-xs" />
            </ConfigField>
          )}
          {(field.measurementType === "temperature") && (
            <ConfigField label="Unit">
              <select value={field.unit ?? "°C"} onChange={(e) => onChange({ unit: e.target.value })} className="input-brutal text-xs">
                <option>°C</option>
                <option>°F</option>
              </select>
            </ConfigField>
          )}
        </div>
      );

    default:
      return null;
  }
}

const OPERATOR_LABELS: Record<ConditionalOperator, string> = {
  equals: "equals",
  not_equals: "not equals",
  greater_than: ">",
  less_than: "<",
  greater_than_or_equal: "≥",
  less_than_or_equal: "≤",
  contains: "contains",
  not_contains: "not contains",
  is_answered: "is answered",
  is_not_answered: "not answered",
  is_one_of: "is one of",
  is_not_one_of: "not one of",
};

const NO_VALUE_OPS = new Set<ConditionalOperator>(["is_answered", "is_not_answered"]);

function ConditionalConfig({
  field,
  allFields,
  onChange,
}: {
  field: FormField;
  allFields: FormField[];
  onChange: (p: Partial<FormField>) => void;
}) {
  const others = allFields.filter(
    (f) => f.id !== field.id && f.type !== "section_header" && f.type !== "page_break",
  );
  const logic: ConditionalLogic | undefined = field.showIf;
  const hasCondition = !!logic;

  const setLogic = (l: ConditionalLogic | undefined) => onChange({ showIf: l });

  const addRule = () => {
    const base: ConditionalLogic = logic ?? { combinator: "AND", rules: [] };
    const firstOther = others[0];
    if (!firstOther) return;
    setLogic({
      ...base,
      rules: [
        ...base.rules,
        { id: ruleId(), fieldId: firstOther.id, operator: "equals", value: "" },
      ],
    });
  };

  const removeRule = (rid: string) => {
    if (!logic) return;
    const next = logic.rules.filter((r) => r.id !== rid);
    setLogic(next.length === 0 ? undefined : { ...logic, rules: next });
  };

  const updateRule = (rid: string, patch: Partial<ConditionalLogic["rules"][0]>) => {
    if (!logic) return;
    setLogic({ ...logic, rules: logic.rules.map((r) => (r.id === rid ? { ...r, ...patch } : r)) });
  };

  const preview = logic && logic.rules.length > 0
    ? logic.rules
        .map((r) => {
          const f = allFields.find((f) => f.id === r.fieldId);
          const lbl = f?.label || r.fieldId;
          const op = OPERATOR_LABELS[r.operator] ?? r.operator;
          return NO_VALUE_OPS.has(r.operator) ? `${lbl} ${op}` : `${lbl} ${op} "${r.value}"`;
        })
        .join(logic.combinator === "AND" ? " AND " : " OR ")
    : null;

  return (
    <div className="border-2 border-border p-3 space-y-2">
      <label className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" /> Conditional logic
        </span>
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={(e) => {
            if (!e.target.checked) { setLogic(undefined); return; }
            if (others[0]) {
              setLogic({ combinator: "AND", rules: [{ id: ruleId(), fieldId: others[0].id, operator: "equals", value: "" }] });
            }
          }}
          className="h-3.5 w-3.5"
        />
      </label>

      {hasCondition && logic && (
        <>
          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-muted-foreground">
            Show if
            <select
              value={logic.combinator}
              onChange={(e) => setLogic({ ...logic, combinator: e.target.value as "AND" | "OR" })}
              className="input-brutal text-[9px] px-1 py-0.5"
            >
              <option value="AND">ALL</option>
              <option value="OR">ANY</option>
            </select>
            of the following:
          </div>

          {others.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Add other fields first.</p>
          ) : (
            <div className="space-y-1.5">
              {logic.rules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
                  <select
                    value={rule.fieldId}
                    onChange={(e) => updateRule(rule.id, { fieldId: e.target.value })}
                    className="input-brutal text-[10px]"
                  >
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>{o.label || "Untitled"}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateRule(rule.id, { operator: e.target.value as ConditionalOperator, value: "" })}
                    className="input-brutal text-[10px]"
                  >
                    {(Object.entries(OPERATOR_LABELS) as [ConditionalOperator, string][]).map(([op, lbl]) => (
                      <option key={op} value={op}>{lbl}</option>
                    ))}
                  </select>
                  <input
                    value={NO_VALUE_OPS.has(rule.operator) ? "" : String(rule.value ?? "")}
                    disabled={NO_VALUE_OPS.has(rule.operator)}
                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                    className="input-brutal text-[10px] disabled:opacity-40"
                    placeholder="value"
                  />
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="border border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={addRule}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest border border-border px-2 py-1 hover:bg-primary/30 w-full justify-center"
              >
                <Plus className="h-3 w-3" /> Add condition
              </button>
            </div>
          )}

          {preview && (
            <div className="rounded bg-muted px-2 py-1 text-[9px] italic text-muted-foreground leading-relaxed">
              Show if: {preview}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Small helper components ──────────────────────────────────────────────────

function ConfigField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
      {hint && <div className="mt-0.5 text-[9px] text-muted-foreground italic">{hint}</div>}
    </div>
  );
}

// ─── Main Form Builder ────────────────────────────────────────────────────────

const CATEGORIES = ["GENERAL", "NUTRITION", "GROWTH", "IMNCI", "RESEARCH", "SCREENING", "CAMP", "CUSTOM"] as const;

export default function FormBuilderPage() {
  const nav = useNavigate();
  const { edit: editId } = Route.useSearch();
  const existingForm = useStore((s) => (editId ? s.forms.find((f) => f.id === editId) : undefined));

  const [title, setTitle] = useState(existingForm?.name ?? "");
  const [category, setCategory] = useState(existingForm?.category ?? "GENERAL");
  const [description, setDescription] = useState(existingForm?.description ?? "");
  const [longitudinal, setLongitudinal] = useState(existingForm?.longitudinal ?? false);
  const [formRole, setFormRole] = useState<import("@/lib/store").FormRole>(existingForm?.formRole ?? "standalone");
  const [subjectIdentifierFieldId, setSubjectIdentifierFieldId] = useState(existingForm?.subjectIdentifierFieldId ?? "");
  const [parentFormId, setParentFormId] = useState(existingForm?.parentFormId ?? "");
  const [parentLinkFieldId, setParentLinkFieldId] = useState(existingForm?.parentLinkFieldId ?? "");
  const [fields, setFields] = useState<FormField[]>(existingForm?.fields ?? []);
  const allForms = useStore((s) => s.forms);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"palette" | "config">("palette");
  const [mobileTab, setMobileTab] = useState<0 | 1 | 2>(1); // 0=Fields 1=Form 2=Settings
  const canvasRef = useRef<HTMLDivElement>(null);
  const isEditing = !!editId;

  useEffect(() => {
    if (existingForm && isEditing) {
      setTitle(existingForm.name);
      setCategory(existingForm.category);
      setDescription(existingForm.description ?? "");
      setLongitudinal(existingForm.longitudinal ?? false);
      setFormRole(existingForm.formRole ?? "standalone");
      setSubjectIdentifierFieldId(existingForm.subjectIdentifierFieldId ?? "");
      setParentFormId(existingForm.parentFormId ?? "");
      setParentLinkFieldId(existingForm.parentLinkFieldId ?? "");
      setFields(existingForm.fields);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  const addField = useCallback((type: FieldType) => {
    const f = makeField(type);
    setFields((prev) => [...prev, f]);
    setSelectedId(f.id);
    setPanelMode("config");
    setMobileTab(1); // switch to Form tab after adding a field
    setTimeout(() => {
      canvasRef.current?.scrollTo({ top: canvasRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  const updateField = useCallback((id: string, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const duplicateField = useCallback((id: string) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], id: uid(), variableName: (prev[idx].variableName ?? "field") + "_copy" };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const deleteField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) { setSelectedId(null); setPanelMode("palette"); }
  }, [selectedId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFields((items) => {
        const oldIdx = items.findIndex((f) => f.id === active.id);
        const newIdx = items.findIndex((f) => f.id === over.id);
        return arrayMove(items, oldIdx, newIdx);
      });
    }
  };

  const save = () => {
    if (!title.trim()) { alert("Form needs a title."); return; }
    if (fields.length === 0) { alert("Add at least one field."); return; }
    const formData = {
      name: title.trim(),
      category,
      description: description.trim(),
      fields,
      longitudinal,
      formRole,
      subjectIdentifierFieldId: formRole === "parent" ? subjectIdentifierFieldId || undefined : undefined,
      parentFormId: formRole === "child" ? parentFormId || undefined : undefined,
      parentLinkFieldId: formRole === "child" ? parentLinkFieldId || undefined : undefined,
    };
    if (isEditing && editId) {
      store.updateForm(editId, formData);
    } else {
      store.addForm(formData);
    }
    nav({ to: "/forms" });
  };

  const PalettePanel = (
    <div className="flex-1 overflow-y-auto p-3 space-y-4 pb-20">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Add field</div>
      {PALETTE.map((group) => (
        <div key={group.group}>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 px-1">{group.group}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {group.items.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => addField(type)}
                className="flex flex-col items-center gap-1.5 border-2 border-border bg-background p-2.5 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30 active:bg-primary transition-colors"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const ConfigPanel = selectedField ? (
    <FieldConfigPanel
      field={selectedField}
      allFields={fields}
      onChange={(patch) => updateField(selectedField.id, patch)}
      onClose={() => { setSelectedId(null); setPanelMode("palette"); setMobileTab(1); }}
    />
  ) : (
    <div className="flex-1 p-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-8">
      Tap a field on the Form tab to configure it
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b-2 border-border bg-primary px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => nav({ to: "/forms" })} className="border-2 border-border bg-card px-2 py-1 text-[10px] font-bold uppercase tracking-widest hover:bg-muted">
            ← Back
          </button>
          <span className="font-display text-xl uppercase leading-none hidden sm:block">
            {isEditing ? (title || "Edit form") : (title || "New form")}
          </span>
        </div>
        <button onClick={save} className="btn-brutal text-sm">
          {isEditing ? "Update" : "Save"}
        </button>
      </div>

      {/* Mobile tab bar — visible only on small screens */}
      <div className="flex border-b-2 border-border bg-card sm:hidden shrink-0">
        {(["Fields", "Form", "Settings"] as const).map((label, i) => (
          <button
            key={label}
            onClick={() => setMobileTab(i as 0 | 1 | 2)}
            className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors ${mobileTab === i ? "border-foreground bg-primary" : "border-transparent hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL — desktop always visible, mobile hidden */}
        <div className="w-72 shrink-0 border-r-2 border-border hidden sm:flex flex-col overflow-hidden bg-card">
          {panelMode === "config" && selectedField ? ConfigPanel : PalettePanel}
        </div>

        {/* Mobile: Fields tab */}
        <div className={`sm:hidden flex-1 overflow-y-auto flex flex-col bg-card ${mobileTab === 0 ? "flex" : "hidden"}`}>
          {PalettePanel}
        </div>

        {/* Mobile: Settings tab */}
        <div className={`sm:hidden flex-1 overflow-y-auto flex flex-col bg-card ${mobileTab === 2 ? "flex" : "hidden"}`}>
          {ConfigPanel}
        </div>

        {/* CANVAS — desktop always visible, mobile only on Form tab */}
        <div ref={canvasRef} className={`flex-1 overflow-y-auto ${mobileTab === 1 ? "block" : "hidden sm:block"}`}>
          <div className="mx-auto max-w-2xl p-6 space-y-6">
            {/* Form metadata */}
            <div className="brutal p-5 space-y-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled form"
                className="w-full border-b-2 border-border bg-transparent pb-2 font-display text-3xl uppercase outline-none placeholder:text-muted-foreground"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</div>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-brutal w-full text-xs font-bold uppercase">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest cursor-pointer">
                    <input type="checkbox" checked={longitudinal} onChange={(e) => setLongitudinal(e.target.checked)} className="h-4 w-4" />
                    <Repeat className="h-4 w-4" />
                    Longitudinal
                  </label>
                </div>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="input-brutal resize-none w-full"
              />

              {/* Form type / hierarchy */}
              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Form type</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { v: "standalone", label: "Standalone" },
                    { v: "parent", label: "Enrollment" },
                    { v: "child", label: "Follow-up" },
                  ] as const).map(({ v, label }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFormRole(v)}
                      className={`border-2 border-border py-2 text-[10px] font-bold uppercase tracking-wider ${formRole === v ? "bg-primary" : "bg-card hover:bg-primary/30"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {formRole === "parent" && (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Subject identifier field</div>
                    <select
                      value={subjectIdentifierFieldId}
                      onChange={(e) => setSubjectIdentifierFieldId(e.target.value)}
                      className="input-brutal w-full text-xs"
                    >
                      <option value="">— pick a field —</option>
                      {fields.filter((f) => ["short_text", "text", "number"].includes(f.type)).map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[9px] text-muted-foreground">The field that uniquely identifies each enrolled subject (e.g. Patient ID, Name)</p>
                  </div>
                )}
                {formRole === "child" && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Linked to parent form</div>
                      <select
                        value={parentFormId}
                        onChange={(e) => setParentFormId(e.target.value)}
                        className="input-brutal w-full text-xs"
                      >
                        <option value="">— select parent form —</option>
                        {allForms.filter((f) => f.formRole === "parent" && f.id !== (editId ?? "")).map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Subject ID field in this form</div>
                      <select
                        value={parentLinkFieldId}
                        onChange={(e) => setParentLinkFieldId(e.target.value)}
                        className="input-brutal w-full text-xs"
                      >
                        <option value="">— pick a field —</option>
                        {fields.filter((f) => ["short_text", "text", "number"].includes(f.type)).map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[9px] text-muted-foreground">Respondent will enter the parent subject ID here to link entries</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-2">
              {fields.length === 0 ? (
                <div
                  onClick={() => addField("short_text")}
                  className="brutal-flat p-10 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground cursor-pointer hover:bg-muted/40 border-2 border-dashed border-border"
                >
                  <Plus className="h-6 w-6 mx-auto mb-2 opacity-40" />
                  Click a field type in the left panel to add it here
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    {fields.map((f) => (
                      <SortableFieldCard
                        key={f.id}
                        field={f}
                        selected={selectedId === f.id}
                        onSelect={() => { setSelectedId(f.id); setPanelMode("config"); setMobileTab(2); }}
                        onDuplicate={() => duplicateField(f.id)}
                        onDelete={() => deleteField(f.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Add field shortcut */}
            {fields.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 pb-6">
                {[
                  { type: "short_text" as FieldType, label: "+ Short text" },
                  { type: "number" as FieldType, label: "+ Number" },
                  { type: "select_one" as FieldType, label: "+ Select one" },
                  { type: "measurement" as FieldType, label: "+ Measurement" },
                ].map(({ type, label }) => (
                  <button key={type} onClick={() => addField(type)} className="border-2 border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-primary/30">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Named export for TanStack Router
function FormBuilderPageWrapper() {
  return <FormBuilderPage />;
}
