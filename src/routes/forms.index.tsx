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
          <Link
            to="/forms/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New
          </Link>
        }
      />
      <PageShell>
        {forms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No forms yet.
          </div>
        ) : (
          <ul className="grid gap-3">
            {forms.map((f) => (
              <li key={f.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{f.name}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {f.category}
                      </span>
                    </div>
                    {f.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {f.description}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {f.fields.length} fields
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Delete form "${f.name}"?`)) store.deleteForm(f.id);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete form"
                  >
                    <Trash2 className="h-4 w-4" />
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
