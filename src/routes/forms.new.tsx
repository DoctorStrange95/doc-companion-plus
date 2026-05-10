import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { store, type FormField, type FieldType } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { GripVertical, Trash2, Plus, Type, Hash, Calendar, ListChecks, AlignLeft, ToggleLeft } from "lucide-react";

export const Route = createFileRoute("/forms/new")({ component: NewForm });

const fieldTypes: { type: FieldType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Short text", icon: Type },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "select", label: "Choice", icon: ListChecks },
  { type: "textarea", label: "Long text", icon: AlignLeft },
  { type: "boolean", label: "Yes/No", icon: ToggleLeft },
];

const uid = () => `f_${Math.random().toString(36).slice(2, 9)}`;

function NewForm() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const add = (type: FieldType) => {
    const f: FormField = {
      id: uid(),
      type,
      label: "Untitled question",
      ...(type === "select" ? { options: ["Option 1", "Option 2"] } : {}),
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

  const save = () => {
    if (!name.trim() || fields.length === 0) {
      alert("Form needs a name and at least one field.");
      return;
    }
    store.addForm({ name: name.trim(), category, description: description.trim(), fields });
    nav({ to: "/forms" });
  };

  return (
    <>
      <PageHeader
        title="New form"
        back="/forms"
        action={
          <button
            onClick={save}
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        }
      />
      <PageShell>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Form name (e.g. Postnatal Check)"
            className="w-full border-b border-border bg-transparent pb-2 text-base font-semibold outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {["General", "Maternal", "Pediatric", "Adolescent", "Chronic", "Survey"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>

        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Questions
        </h2>

        {fields.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            Add fields from the palette below.
          </div>
        )}

        <ul className="space-y-2">
          {fields.map((f, i) => (
            <li key={f.id} className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex flex-col">
                  <button
                    onClick={() => move(f.id, -1)}
                    disabled={i === 0}
                    className="text-muted-foreground disabled:opacity-30"
                  >
                    <GripVertical className="h-4 w-4 rotate-180" />
                  </button>
                </div>
                <button
                  onClick={() => setEditing(editing === f.id ? null : f.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{f.label || "Untitled"}</span>
                    {f.required && <span className="text-xs text-destructive">*</span>}
                  </div>
                  <span className="text-[11px] uppercase text-muted-foreground">
                    {f.type}
                    {f.unit ? ` · ${f.unit}` : ""}
                  </span>
                </button>
                <button
                  onClick={() => remove(f.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {editing === f.id && (
                <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-3">
                  <input
                    value={f.label}
                    onChange={(e) => update(f.id, { label: e.target.value })}
                    placeholder="Question label"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                  {f.type === "number" && (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        placeholder="Unit"
                        value={f.unit ?? ""}
                        onChange={(e) => update(f.id, { unit: e.target.value })}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                      <input
                        type="number"
                        placeholder="Min"
                        value={f.min ?? ""}
                        onChange={(e) => update(f.id, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={f.max ?? ""}
                        onChange={(e) => update(f.id, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  )}
                  {f.type === "select" && (
                    <textarea
                      placeholder="One option per line"
                      value={(f.options ?? []).join("\n")}
                      onChange={(e) =>
                        update(f.id, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
                      }
                      rows={3}
                      className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) => update(f.id, { required: e.target.checked })}
                    />
                    Required
                  </label>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Add field
          </div>
          <div className="grid grid-cols-3 gap-2">
            {fieldTypes.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => add(type)}
                className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background p-3 text-xs hover:border-primary hover:text-primary"
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
