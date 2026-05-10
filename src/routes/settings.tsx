import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, store } from "@/lib/store";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Download, RotateCcw, Wifi, WifiOff } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const worker = useStore((s) => s.worker);
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const [name, setName] = useState(worker.name);
  const [village, setVillage] = useState(worker.village);
  const [saved, setSaved] = useState(false);
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  const save = () => {
    store.setWorker({ name: name.trim() || "Health Worker", village: village.trim() || "Unknown" });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `communitymed-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Settings" />
      <PageShell>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Health worker profile</h2>
          <label className="mb-1 block text-xs font-medium">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-3 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          />
          <label className="mb-1 block text-xs font-medium">Posted at (village/PHC)</label>
          <input
            value={village}
            onChange={(e) => setVillage(e.target.value)}
            className="mb-3 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          />
          <button
            onClick={save}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {saved ? "Saved ✓" : "Save profile"}
          </button>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Sync status</h2>
          <div className="flex items-center gap-2 text-sm">
            {online ? (
              <>
                <Wifi className="h-4 w-4 text-primary" /> Online — data stored locally on this device
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-destructive" /> Offline — data is queued locally
              </>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {patients.length} patients · {submissions.length} visits saved on this device
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Data</h2>
          <div className="flex flex-col gap-2">
            <button
              onClick={exportData}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted/50"
            >
              <Download className="h-4 w-4" /> Export all data (JSON)
            </button>
            <button
              onClick={() => {
                if (confirm("Reset all data? This will delete all patients, forms, and visits on this device.")) {
                  store.reset();
                }
              }}
              className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <RotateCcw className="h-4 w-4" /> Reset to seed data
            </button>
          </div>
        </section>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          CommunityMed Pro · MVP v0.1 · Data stays on this device until sync is configured.
        </p>
      </PageShell>
    </>
  );
}
