import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore, store } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Plus, FileText, Trash2 } from "lucide-react";

export const Route = createFileRoute("/forms/")({ component: FormsList });

function FormsList() {
  const forms = useStore((s) => s.forms);

  return (
    <>
      <PageHeader
        title="Form library"
        subtitle={`${forms.length} forms`}
        action={
          <Link to="/forms/new" className="btn-brutal inline-flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> New
          </Link>
        }
      />
      <PageShell>
        {forms.length === 0 ? (
          <div className="brutal-flat p-8 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            No forms yet
          </div>
        ) : (
          <ul className="grid gap-3">
            {forms.map((f) => (
              <li key={f.id} className="brutal p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-border bg-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-lg uppercase leading-tight">{f.name}</h3>
                      <span className="chip">{f.category}</span>
                    </div>
                    {f.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-muted-foreground">{f.description}</p>
                    )}
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {f.fields.length} fields
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Link
                        to="/forms/$id/fill"
                        params={{ id: f.id }}
                        className="btn-brutal text-[11px]"
                      >
                        Fill form
                      </Link>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Delete form "${f.name}"?`)) store.deleteForm(f.id);
                    }}
                    className="border-2 border-border p-1.5 hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Delete form"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
