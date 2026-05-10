import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Search } from "lucide-react";

export const Route = createFileRoute("/tools/imnci")({ component: IMNCITool });

type Sign = { text: string; tone: "destructive" | "warning" | "success"; action: string };
type Condition = { id: string; name: string; ageGroup: "0–2 mo" | "2 mo – 5 y"; signs: Sign[] };

const conditions: Condition[] = [
  {
    id: "general-danger",
    name: "General Danger Signs",
    ageGroup: "2 mo – 5 y",
    signs: [
      { text: "Not able to drink or breastfeed", tone: "destructive", action: "Refer urgently to hospital" },
      { text: "Vomits everything", tone: "destructive", action: "Refer urgently" },
      { text: "Convulsions or convulsing now", tone: "destructive", action: "Refer urgently — give diazepam if convulsing" },
      { text: "Lethargic or unconscious", tone: "destructive", action: "Refer urgently" },
    ],
  },
  {
    id: "cough",
    name: "Cough or Difficult Breathing",
    ageGroup: "2 mo – 5 y",
    signs: [
      { text: "Chest indrawing OR stridor in calm child", tone: "destructive", action: "Severe pneumonia — refer urgently, give first dose of antibiotic" },
      { text: "Fast breathing (≥50/min if 2–11 mo, ≥40/min if 12 mo–5 y)", tone: "warning", action: "Pneumonia — oral amoxicillin, follow-up 3 days" },
      { text: "No fast breathing & no chest indrawing", tone: "success", action: "Cough or cold — soothe throat, home care" },
    ],
  },
  {
    id: "diarrhoea",
    name: "Diarrhoea",
    ageGroup: "2 mo – 5 y",
    signs: [
      { text: "Lethargic, sunken eyes, skin pinch ≥2 sec", tone: "destructive", action: "Severe dehydration — IV fluids (Plan C), refer" },
      { text: "Restless/irritable, drinks eagerly, sunken eyes", tone: "warning", action: "Some dehydration — ORS Plan B in clinic" },
      { text: "No signs of dehydration", tone: "success", action: "Plan A — ORS at home, zinc 14 days, continue feeding" },
      { text: "Blood in stool", tone: "warning", action: "Dysentery — ciprofloxacin per protocol" },
    ],
  },
  {
    id: "fever",
    name: "Fever",
    ageGroup: "2 mo – 5 y",
    signs: [
      { text: "Stiff neck, bulging fontanelle, or general danger sign", tone: "destructive", action: "Very severe febrile disease — IM antibiotic + refer" },
      { text: "Fever ≥7 days OR in malaria area", tone: "warning", action: "Investigate — RDT for malaria; treat as per result" },
      { text: "Generalised rash + cough/coryza/red eyes", tone: "warning", action: "Suspect measles — Vit A, follow-up 2 days" },
    ],
  },
  {
    id: "ear",
    name: "Ear Problem",
    ageGroup: "2 mo – 5 y",
    signs: [
      { text: "Tender swelling behind the ear", tone: "destructive", action: "Mastoiditis — first dose antibiotic + refer urgently" },
      { text: "Pus draining <14 days OR ear pain", tone: "warning", action: "Acute ear infection — amoxicillin 5 days, dry wicking" },
      { text: "Pus draining ≥14 days", tone: "warning", action: "Chronic ear infection — dry wicking, topical drops" },
    ],
  },
  {
    id: "young-infant",
    name: "Young Infant — Possible Serious Bacterial Infection",
    ageGroup: "0–2 mo",
    signs: [
      { text: "Not feeding well, movement only on stimulation, fever ≥37.5 or hypothermia <35.5", tone: "destructive", action: "PSBI — first dose antibiotic + urgent referral" },
      { text: "Severe chest indrawing, grunting", tone: "destructive", action: "Refer urgently with first dose antibiotic" },
      { text: "Umbilicus red/pus, skin pustules <10", tone: "warning", action: "Local infection — topical care + oral antibiotic" },
    ],
  },
];

function IMNCITool() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(conditions[0].id);
  const filtered = conditions.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.signs.some((s) => s.text.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader title="IMNCI Reference" back="/tools" variant="yellow" subtitle="Childhood illness protocols" />
      <PageShell>
        <div className="brutal mb-4 flex items-center gap-2 p-3">
          <Search className="h-4 w-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search symptoms or conditions"
            className="input-brutal !border-0 !p-0 text-sm shadow-none focus:shadow-none"
          />
        </div>

        <ul className="space-y-3">
          {filtered.map((c) => (
            <li key={c.id} className="brutal">
              <button
                onClick={() => setOpen(open === c.id ? null : c.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-primary/30"
              >
                <div>
                  <div className="font-display text-lg uppercase leading-tight">{c.name}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{c.ageGroup}</div>
                </div>
                <span className="chip chip-yellow">{open === c.id ? "−" : "+"}</span>
              </button>
              {open === c.id && (
                <ul className="divide-y-2 divide-border border-t-2 border-border">
                  {c.signs.map((s, i) => {
                    const stripe =
                      s.tone === "destructive"
                        ? "bg-destructive text-destructive-foreground"
                        : s.tone === "warning"
                          ? "bg-primary"
                          : "bg-success";
                    const tag = s.tone === "destructive" ? "PINK · Refer" : s.tone === "warning" ? "YELLOW · Treat" : "GREEN · Home";
                    return (
                      <li key={i} className="flex">
                        <div className={`flex w-2 ${stripe}`} />
                        <div className="flex-1 p-3">
                          <div className="text-sm font-semibold">{s.text}</div>
                          <div className="mt-1 text-[11px] font-bold uppercase tracking-wider">{tag}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{s.action}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="brutal-flat p-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
              No matches
            </li>
          )}
        </ul>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Summary reference. Always cross-check with the WHO/MoHFW IMNCI chart booklet before clinical action.
        </p>
      </PageShell>
    </>
  );
}
