import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, store, sync } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { AuthRequired } from "@/components/AuthGate";
import { PageHeader, PageShell, SectionTitle } from "@/components/PageShell";
import { Download, RotateCcw, Wifi, WifiOff, LogOut, RefreshCw, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const worker = useStore((s) => s.worker);
  const patients = useStore((s) => s.patients);
  const submissions = useStore((s) => s.submissions);
  const queue = useStore((s) => s.queue);
  const lastSync = useStore((s) => s.lastSync);
  const syncing = useStore((s) => s.syncing);
  const { user, logout } = useAuth();
  const [name, setName] = useState(worker.name === "Health Worker" && user?.name ? user.name : worker.name);
  const [village, setVillage] = useState(worker.village);
  const [saved, setSaved] = useState(false);
  const [syncError, setSyncError] = useState("");
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const syncStuck = queue.length > 10 && lastSync && (Date.now() - lastSync) > 5 * 60 * 1000;

  if (!user) return <AuthRequired action="access settings" />;

  const save = () => {
    store.setWorker({ name: name.trim() || user?.name || "Health Worker", village: village.trim() || "Unknown" });
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
      <PageHeader title="Settings" variant="dark" />
      <PageShell>
        <section className="brutal p-4">
          <SectionTitle kicker="Worker">Profile</SectionTitle>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-brutal mb-3" />
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest">Posted at</label>
          <input value={village} onChange={(e) => setVillage(e.target.value)} className="input-brutal mb-3" />
          <button onClick={save} className="btn-brutal">{saved ? "Saved ✓" : "Save profile"}</button>
        </section>

        <section className="brutal mt-4 p-4">
          <SectionTitle kicker="Sync">Status</SectionTitle>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            {online ? (
              <><Wifi className="h-4 w-4" /> Online — auto-sync</>
            ) : (
              <><WifiOff className="h-4 w-4 text-destructive" /> Offline — queued</>
            )}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {patients.length} patients · {submissions.length} visits on device
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {queue.length > 0
              ? `${queue.length} pending change${queue.length === 1 ? "" : "s"} · `
              : "All changes synced"}
            {lastSync ? `last sync ${new Date(lastSync).toLocaleTimeString()}` : "never synced"}
          </div>
          {syncStuck && (
            <div className="mt-2 flex items-start gap-2 border-2 border-destructive bg-destructive/10 p-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-destructive">
                Sync appears stuck. Sign out and sign back in — this usually fixes it.
              </p>
            </div>
          )}
          {syncError && (
            <p className="mt-1 text-[11px] font-bold text-destructive">{syncError}</p>
          )}
          <button
            onClick={async () => {
              setSyncError("");
              try {
                await sync.drain();
                await sync.pull();
              } catch {
                setSyncError("Sync failed — check your connection and try again.");
              }
            }}
            disabled={syncing || !online || !user}
            data-testid="sync-now-btn"
            className="btn-brutal mt-3 flex w-full items-center justify-center gap-2 bg-card disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Sync now
          </button>
        </section>

        {user && (
          <section className="brutal mt-4 p-4" data-testid="account-section">
            <SectionTitle kicker="Account">Signed in as</SectionTitle>
            <div className="font-display text-lg uppercase">{user.name || user.email}</div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {user.email}
            </div>
            <button
              onClick={() => {
                void logout();
              }}
              data-testid="logout-btn"
              className="btn-brutal mt-3 flex w-full items-center justify-center gap-2 bg-destructive text-destructive-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </section>
        )}

        <section className="brutal mt-4 p-4">
          <SectionTitle kicker="Data">Export</SectionTitle>
          <div className="flex flex-col gap-2">
            <button onClick={exportData} className="btn-brutal flex items-center justify-center gap-2 bg-card">
              <Download className="h-4 w-4" /> Export JSON
            </button>
            <button
              onClick={() => {
                if (confirm("Reset all data? This will delete patients, forms, and visits on this device.")) store.reset();
              }}
              className="btn-brutal flex items-center justify-center gap-2 bg-destructive text-destructive-foreground"
            >
              <RotateCcw className="h-4 w-4" /> Reset to seed
            </button>
          </div>
        </section>

        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          ResearchMed · MVP v0.2
        </p>
      </PageShell>
    </>
  );
}
