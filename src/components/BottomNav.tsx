import { Link, useLocation } from "@tanstack/react-router";
import { Home, Users, FilePlus2, BarChart3, Settings } from "lucide-react";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/patients", label: "Patients", icon: Users },
  { to: "/forms", label: "Forms", icon: FilePlus2 },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-2xl items-center justify-around px-2 py-1.5">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={`flex min-w-[60px] flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "stroke-[2.4]" : ""}`} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
