import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  store,
  type FormField,
  type FieldType,
  type SkipRule,
  type SkipOp,
  type VisibleIf,
} from "@/lib/store";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import {
  GripVertical,
  Trash2,
  Plus,
  Type,
  Hash,
  Calendar,
  ListChecks,
  AlignLeft,
  ToggleLeft,
  Circle,
  CheckSquare,
  MapPin,
  GitBranch,
  Repeat,
} from "lucide-react";

export const Route = createFileRoute("/forms/new")({ component: NewForm });

const fieldTypes: { type: FieldType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Short text", icon: Type },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "select", label: "Choice", icon: ListChecks },
  { type: "radio", label: "Select one", icon: Circle },
  { type: "multiselect", label: "Select many", icon: CheckSquare },
  { type: "textarea", label: "Long text", icon: AlignLeft },
  { type: "boolean", label: "Yes/No", icon: ToggleLeft },
  { type: "location", label: "Location", icon: MapPin },
];

const opLabels: Record<SkipOp, string> = {
  eq: "equals",
  neq: "not equals",
  gt: ">",
  lt: "<",
  contains: "contains",
};

const uid = () => `f_${Math.random().toString(36).slice(2, 9)}`;

function NewForm() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [description, setDescription] = useState("");
  const [longitudinal, setLongitudinal] = useState(false);
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const add = (type: FieldType) => {
    const f: FormField = {
      id: uid(),
      type,
      label: "Untitled question",
      ...(type === "select" || type === "radio" || type === "multiselect"
        ? { options: ["Option 1", "Option 2"] }
        : {}),
    };
    setFields([...fields, f]);
    setEditing(f.id);
  };

  const update = (id: string, patch: Partial<FormField>) =>
    setFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => setFields(fields.filter((f) => f.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = fields.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };

  const updateVisibleIf = (id: string, vi: VisibleIf | undefined) =>
    update(id, { visibleIf: vi });

  const save = () => {
    if (!name.trim() || fields.length === 0) {
      alert("Form needs a name and at least one field.");
      return;
    }
    store.addForm({
      name: name.trim(),
      category,
      description: description.trim(),
      fields,
      longitudinal,
    });
    nav({ to: "/forms" });
  };

  return (
    <>
      <PageHeader
        title="New form"
        back="/forms"
        variant="yellow"
        action={
          <button
            onClick={save}
            data-testid="save-form-btn"
            className="btn-brutal text-xs"
          >
            Save
          </button>
        }
      />
      <PageShell>
        <div className="brutal space-y-3 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Form name"
            data-testid="form-name-input"
            className="w-full border-b-2 border-border bg-transparent pb-2 font-display text-2xl uppercase outline-none placeholder:text-muted-foreground"
          />
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="form-category-select"
              className="input-brutal w-auto text-xs font-bold uppercase"
            >
              {["General", "Maternal", "Pediatric", "Adolescent", "Chronic", "Survey"].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="input-brutal resize-none"
          />
          <label
            data-testid="longitudinal-toggle"
            className={`flex cursor-pointer items-center justify-between gap-3 border-2 border-border p-3 transition-colors ${
              longitudinal ? "bg-secondary text-secondary-foreground" : "bg-card"
            }`}
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              <Repeat className="h-4 w-4" />
              Longitudinal tracking
            </span>
            <input
              type="checkbox"
              checked={longitudinal}
              onChange={(e) => setLongitudinal(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          {longitudinal && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              This form is repeatable per patient — submissions plot trends over time.
            </p>
          )}
        </div>

        <div className="mt-6">
          <SectionTitle kicker={`${fields.length}`}>Questions</SectionTitle>

          {fields.length === 0 && (
            <div className="brutal-flat p-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Add fields from the palette below
            </div>
          )}

          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li key={f.id} className="brutal" data-testid={`field-row-${f.id}`}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    onClick={() => move(f.id, -1)}
                    disabled={i === 0}
                    className="disabled:opacity-30"
                  >
                    <GripVertical className="h-4 w-4 rotate-180" />
                  </button>
                  <button
                    onClick={() => setEditing(editing === f.id ? null : f.id)}
                    className="min-w-0 flex-1 text-left"
                    data-testid={`field-edit-toggle-${f.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">
                        {f.label || "Untitled"}
                      </span>
                      {f.required && (
                        <span className="text-xs font-bold text-destructive">*</span>
                      )}
                      {f.visibleIf && f.visibleIf.rules.length > 0 && (
                        <span
                          title="Skip logic enabled"
                          className="flex items-center gap-0.5 border-2 border-border bg-secondary px-1 text-[9px] font-bold uppercase text-secondary-foreground"
                        >
                          <GitBranch className="h-2.5 w-2.5" /> if
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {f.type}
                      {f.unit ? ` · ${f.unit}` : ""}
                    </span>
                  </button>
                  <button
                    onClick={() => remove(f.id)}
                    data-testid={`field-remove-${f.id}`}
                    className="border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {editing === f.id && (
                  <div className="space-y-3 border-t-2 border-border bg-muted/40 px-3 py-3">
                    <input
                      value={f.label}
                      onChange={(e) => update(f.id, { label: e.target.value })}
                      placeholder="Question label"
                      data-testid={`field-label-${f.id}`}
                      className="input-brutal"
                    />
                    {f.type === "number" && (
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          placeholder="Unit"
                          value={f.unit ?? ""}
                          onChange={(e) => update(f.id, { unit: e.target.value })}
                          className="input-brutal text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Min"
                          value={f.min ?? ""}
                          onChange={(e) =>
                            update(f.id, {
                              min:
                                e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                          className="input-brutal text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          value={f.max ?? ""}
                          onChange={(e) =>
                            update(f.id, {
                              max:
                                e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                          className="input-brutal text-xs"
                        />
                      </div>
                    )}
                    {(f.type === "select" ||
                      f.type === "radio" ||
                      f.type === "multiselect") && (
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Options (one per line)
                        </label>
                        <textarea
                          placeholder="One option per line"
                          value={(f.options ?? []).join("\n")}
                          onChange={(e) =>
                            update(f.id, {
                              options: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          rows={3}
                          data-testid={`field-options-${f.id}`}
                          className="input-brutal resize-none text-xs"
                        />
                      </div>
                    )}
                    {f.type === "location" && (
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Captures GPS lat/lng from the device when filling out the form.
                      </p>
                    )}

                    <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        onChange={(e) => update(f.id, { required: e.target.checked })}
                      />
                      Required
                    </label>

                    <SkipLogicEditor
                      field={f}
                      others={fields.filter((x) => x.id !== f.id)}
                      onChange={(vi) => updateVisibleIf(f.id, vi)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="brutal mt-6 p-3">
          <div className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest">
            <Plus className="h-3.5 w-3.5" /> Add field
          </div>
          <div className="grid grid-cols-3 gap-2">
            {fieldTypes.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => add(type)}
                data-testid={`add-field-${type}`}
                className="flex flex-col items-center gap-1 border-2 border-border bg-card p-3 text-[11px] font-bold uppercase tracking-wider hover:bg-primary"
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </PageShell>
    </>
  );
}

function SkipLogicEditor({
  field,
  others,
  onChange,
}: {
  field: FormField;
  others: FormField[];
  onChange: (vi: VisibleIf | undefined) => void;
}) {
  const enabled = !!field.visibleIf;
  const vi = field.visibleIf ?? { mode: "all" as const, rules: [] };

  const toggle = (on: boolean) => {
    if (!on) onChange(undefined);
    else onChange({ mode: "all", rules: [] });
  };

  const addRule = () => {
    const target = others[0];
    if (!target) return;
    const rule: SkipRule = { fieldId: target.id, op: "eq", value: "" };
    onChange({ ...vi, rules: [...vi.rules, rule] });
  };
  const updateRule = (i: number, patch: Partial<SkipRule>) => {
    const rules = vi.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange({ ...vi, rules });
  };
  const removeRule = (i: number) =>
    onChange({ ...vi, rules: vi.rules.filter((_, idx) => idx !== i) });

  return (
    <div className="border-2 border-border bg-card p-2.5">
      <label className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest">
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          Skip logic
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          data-testid={`skip-toggle-${field.id}`}
        />
      </label>

      {enabled && (
        <div className="mt-2 space-y-2">
          {others.length === 0 ? (
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Add another field above first to reference.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                <span>Show when</span>
                <select
                  value={vi.mode}
                  onChange={(e) =>
                    onChange({ ...vi, mode: e.target.value as "all" | "any" })
                  }
                  className="input-brutal w-auto text-[10px]"
                >
                  <option value="all">all rules match</option>
                  <option value="any">any rule matches</option>
                </select>
              </div>

              {vi.rules.map((r, i) => {
                const target = others.find((o) => o.id === r.fieldId) ?? others[0];
                const isNumeric = target?.type === "number";
                return (
                  <div
                    key={i}
                    data-testid={`skip-rule-${field.id}-${i}`}
                    className="grid grid-cols-12 items-center gap-1.5 border-2 border-border bg-muted/40 p-2"
                  >
                    <select
                      value={r.fieldId}
                      onChange={(e) => updateRule(i, { fieldId: e.target.value })}
                      className="input-brutal col-span-5 text-[10px]"
                    >
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label || "Untitled"}
                        </option>
                      ))}
                    </select>
                    <select
                      value={r.op}
                      onChange={(e) => updateRule(i, { op: e.target.value as SkipOp })}
                      className="input-brutal col-span-3 text-[10px]"
                    >
                      {(Object.keys(opLabels) as SkipOp[])
                        .filter((op) => (isNumeric ? true : op === "eq" || op === "neq" || op === "contains"))
                        .map((op) => (
                          <option key={op} value={op}>
                            {opLabels[op]}
                          </option>
                        ))}
                    </select>
                    {target?.type === "select" ||
                    target?.type === "radio" ||
                    target?.type === "multiselect" ? (
                      <select
                        value={String(r.value)}
                        onChange={(e) => updateRule(i, { value: e.target.value })}
                        className="input-brutal col-span-3 text-[10px]"
                      >
                        <option value="">—</option>
                        {(target.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : target?.type === "boolean" ? (
                      <select
                        value={String(r.value)}
                        onChange={(e) => updateRule(i, { value: e.target.value })}
                        className="input-brutal col-span-3 text-[10px]"
                      >
                        <option value="">—</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type={isNumeric ? "number" : "text"}
                        value={String(r.value)}
                        onChange={(e) =>
                          updateRule(i, {
                            value: isNumeric ? Number(e.target.value) : e.target.value,
                          })
                        }
                        className="input-brutal col-span-3 text-[10px]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeRule(i)}
                      data-testid={`skip-rule-remove-${field.id}-${i}`}
                      className="col-span-1 border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addRule}
                data-testid={`skip-add-rule-${field.id}`}
                className="flex w-full items-center justify-center gap-1 border-2 border-border bg-card py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-primary"
              >
                <Plus className="h-3 w-3" /> Add rule
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
