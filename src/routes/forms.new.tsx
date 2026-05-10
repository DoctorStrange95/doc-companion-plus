import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { store, type FormField, type FieldType } from "@/lib/store";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
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
        variant="yellow"
        action={
          <button onClick={save} className="btn-brutal text-xs">Save</button>
        }
      />
      <PageShell>
        <div className="brutal space-y-3 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Form name"
            className="w-full border-b-2 border-border bg-transparent pb-2 font-display text-2xl uppercase outline-none placeholder:text-muted-foreground"
          />
          <div className="flex gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-brutal w-auto text-xs font-bold uppercase">
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
            className="input-brutal resize-none"
          />
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
              <li key={f.id} className="brutal">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => move(f.id, -1)} disabled={i === 0} className="disabled:opacity-30">
                    <GripVertical className="h-4 w-4 rotate-180" />
                  </button>
                  <button onClick={() => setEditing(editing === f.id ? null : f.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{f.label || "Untitled"}</span>
                      {f.required && <span className="text-xs font-bold text-destructive">*</span>}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {f.type}{f.unit ? ` · ${f.unit}` : ""}
                    </span>
                  </button>
                  <button onClick={() => remove(f.id)} className="border-2 border-border p-1 hover:bg-destructive hover:text-destructive-foreground">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {editing === f.id && (
                  <div className="space-y-2 border-t-2 border-border bg-muted/40 px-3 py-3">
                    <input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} placeholder="Question label" className="input-brutal" />
                    {f.type === "number" && (
                      <div className="grid grid-cols-3 gap-2">
                        <input placeholder="Unit" value={f.unit ?? ""} onChange={(e) => update(f.id, { unit: e.target.value })} className="input-brutal text-xs" />
                        <input type="number" placeholder="Min" value={f.min ?? ""} onChange={(e) => update(f.id, { min: e.target.value === "" ? undefined : Number(e.target.value) })} className="input-brutal text-xs" />
                        <input type="number" placeholder="Max" value={f.max ?? ""} onChange={(e) => update(f.id, { max: e.target.value === "" ? undefined : Number(e.target.value) })} className="input-brutal text-xs" />
                      </div>
                    )}
                    {f.type === "select" && (
                      <textarea
                        placeholder="One option per line"
                        value={(f.options ?? []).join("\n")}
                        onChange={(e) => update(f.id, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                        rows={3}
                        className="input-brutal resize-none text-xs"
                      />
                    )}
                    <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                      <input type="checkbox" checked={!!f.required} onChange={(e) => update(f.id, { required: e.target.checked })} />
                      Required
                    </label>
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
