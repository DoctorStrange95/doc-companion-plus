import { Link, useLocation } from "@tanstack/react-router";
import { Home, BarChart3, FilePlus2, Wrench, Settings, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth";

const authTabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/forms", label: "Forms", icon: FilePlus2 },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const guestTabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/forms", label: "Forms", icon: FilePlus2 },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/login", label: "Sign In", icon: LogIn },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const tabs = user ? authTabs : guestTabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-border bg-card print:hidden">
      <div className="mx-auto flex max-w-2xl items-stretch justify-between">
        {tabs.map(({ to, label, icon: Icon }, i) => {
          const active =
            to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={`relative flex flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                i < tabs.length - 1 ? "border-r-2 border-border" : ""
              } ${active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
