import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/PageShell";
import { Calculator, Scale, TrendingUp, Apple, BookOpen, FilePlus2 } from "lucide-react";

export const Route = createFileRoute("/tools/")({ component: ToolsIndex });

const tools = [
  {
    to: "/tools/sample-size",
    title: "Sample Size",
    desc: "Cochran, two-proportion, mean tests",
    icon: Calculator,
    tone: "primary",
  },
  {
    to: "/tools/bmi",
    title: "BMI",
    desc: "Adult BMI · Asian & WHO cutoffs",
    icon: Scale,
    tone: "card",
  },
  {
    to: "/tools/growth",
    title: "Growth Chart",
    desc: "Weight-for-age 0–60 mo (WHO)",
    icon: TrendingUp,
    tone: "card",
  },
  {
    to: "/tools/nutrition",
    title: "Nutrition RDA",
    desc: "ICMR-2020 daily requirements",
    icon: Apple,
    tone: "card",
  },
  {
    to: "/tools/imnci",
    title: "IMNCI Reference",
    desc: "Childhood illness protocols",
    icon: BookOpen,
    tone: "card",
  },
  {
    to: "/forms",
    title: "Form Builder",
    desc: "Build & deploy questionnaires",
    icon: FilePlus2,
    tone: "card",
  },
] as const;

function ToolsIndex() {
  return (
    <>
      <PageHeader title="Clinical Tools" subtitle="Calculators · references" variant="yellow" />
      <PageShell>
        <ul className="grid gap-3">
          {tools.map((t) => (
            <li key={t.to}>
              <Link
                to={t.to}
                className={`brutal-sm flex items-center gap-4 p-4 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 ${
                  t.tone === "primary" ? "bg-primary" : "bg-card hover:bg-primary/40"
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-border bg-card">
                  <t.icon className="h-6 w-6" strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xl uppercase leading-none">{t.title}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.desc}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </PageShell>
    </>
  );
}
