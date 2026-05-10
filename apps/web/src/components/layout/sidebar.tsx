import { useLocation, Link } from "wouter";
import {
  Activity, LayoutDashboard, Settings2, AlertTriangle, ShieldAlert,
  ListVideo, Waves, Bot, FlaskConical, Leaf, Siren, Bus, Calendar, Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrafficStore } from "@/lib/store";

const navItems = [
  { href: "/",           label: "Dashboard",      icon: LayoutDashboard },
  { href: "/analytics",  label: "Analytics",      icon: Activity },
  { href: "/control",    label: "Control",        icon: Settings2 },
  { href: "/emergency",  label: "Emergency",      icon: AlertTriangle },
  { href: "/signal-log", label: "Signal Log",     icon: ListVideo },
  { href: "/green-wave", label: "Green Wave",     icon: Waves },
  { href: "/copilot",    label: "AI Copilot",     icon: Bot },
  { href: "/scenarios",  label: "What-If Sim",    icon: FlaskConical },
];

const newNavItems = [
  { href: "/carbon",     label: "Carbon Savings", icon: Leaf },
  { href: "/incidents",  label: "Incidents",      icon: Siren },
  { href: "/transit",    label: "Transit Priority", icon: Bus },
  { href: "/schedule",   label: "Schedule",       icon: Calendar },
  { href: "/network",    label: "Network Opt.",   icon: Network },
];

const LANE_LABELS = ["N", "S", "E", "W"];
const LEVEL_COLOR: Record<string, string> = {
  low: "bg-green-500",
  medium: "bg-yellow-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};
const LEVEL_TEXT: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

export function Sidebar() {
  const [location] = useLocation();
  const { lanes, signals, connected, activeEmergency, unreadCount } = useTrafficStore();

  const laneList = [0, 1, 2, 3].map(id => ({
    id,
    label: LANE_LABELS[id],
    level: (lanes[id]?.congestion_level ?? "low") as string,
    density: lanes[id]?.density ?? 0,
  }));

  const hasEmergency = !!activeEmergency;

  const renderNavItem = (item: { href: string; label: string; icon: React.ElementType }, isNewSection = false) => {
    const isActive = location === item.href;
    const Icon = item.icon;
    const isEmergencyNav = item.href === "/emergency";
    const isIncidentsNav = item.href === "/incidents";
    const showEmergencyBadge = isEmergencyNav && hasEmergency;
    const showAlertBadge = item.href === "/" && unreadCount > 0;
    const isAiItem = item.href === "/copilot" || item.href === "/scenarios";

    return (
      <Link key={item.href} href={item.href} className="block">
        <div className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-150 group cursor-pointer relative",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          showEmergencyBadge && !isActive && "text-red-400 hover:text-red-300 hover:bg-red-500/10",
          isIncidentsNav && !isActive && "hover:text-orange-300 hover:bg-orange-500/10",
        )}>
          <Icon className={cn(
            "w-4 h-4 shrink-0",
            isActive ? "text-primary" : showEmergencyBadge ? "text-red-400" : "text-muted-foreground group-hover:text-foreground",
          )} />
          <span className="font-medium text-sm">{item.label}</span>
          <div className="ml-auto flex items-center gap-1">
            {isAiItem && !isActive && (
              <span className="text-[8px] bg-primary/20 text-primary px-1 py-0.5 rounded font-mono">AI</span>
            )}
            {isNewSection && !isActive && (
              <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded font-mono">NEW</span>
            )}
            {showEmergencyBadge && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
            {showAlertBadge && !isActive && (
              <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-mono">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
            {isActive && !showEmergencyBadge && (
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="w-64 border-r bg-card flex flex-col h-full overflow-hidden">
      <div className="p-5 border-b flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shrink-0">
          <ShieldAlert className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="font-bold tracking-tight text-lg text-primary leading-tight">NEXUS</h1>
          <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Junction Control</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => renderNavItem(item, false))}

        <div className="pt-3 pb-1">
          <p className="text-[9px] font-semibold tracking-widest text-muted-foreground/50 uppercase px-3 mb-1.5">
            Impact Features
          </p>
          {newNavItems.map(item => renderNavItem(item, true))}
        </div>

        <div className="mt-4 pt-4 border-t border-border/40">
          <p className="text-[9px] font-semibold tracking-widest text-muted-foreground/50 uppercase px-3 mb-2">
            Live Lanes
          </p>
          <div className="space-y-1.5 px-1">
            {laneList.map(({ id, label, level, density }) => (
              <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/20 hover:bg-muted/40 transition-colors">
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", LEVEL_COLOR[level] ?? "bg-green-500")} />
                <span className="text-[10px] text-muted-foreground font-mono w-4">{label}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      level === "critical" ? "bg-red-500" :
                      level === "high" ? "bg-orange-500" :
                      level === "medium" ? "bg-yellow-500" : "bg-green-500"
                    )}
                    style={{ width: `${Math.min(100, density)}%` }}
                  />
                </div>
                <span className={cn("text-[9px] font-mono w-8 text-right shrink-0", LEVEL_TEXT[level] ?? "text-green-400")}>
                  {Math.round(density)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {signals && (
          <div className="mt-3 px-1">
            <div className="grid grid-cols-4 gap-1 bg-muted/20 rounded-lg p-2">
              {[0, 1, 2, 3].map(id => {
                const phase = signals.phases?.[id] ?? "red";
                const isGreen = phase === "green";
                const isYellow = phase === "yellow";
                const isEmerg = signals.emergency_active && signals.emergency_lane === id;
                return (
                  <div key={id} className="flex flex-col items-center gap-1">
                    <div className={cn(
                      "w-3 h-3 rounded-full transition-all duration-300",
                      isEmerg ? "bg-red-500 animate-pulse shadow-[0_0_6px_theme(colors.red.500)]" :
                      isGreen ? "bg-green-500 shadow-[0_0_6px_theme(colors.green.500)]" :
                      isYellow ? "bg-yellow-500" : "bg-red-900"
                    )} />
                    <span className="text-[8px] text-muted-foreground/50 font-mono">{LANE_LABELS[id]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      <div className="p-4 border-t space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", connected ? "bg-green-500 shadow-[0_0_4px_theme(colors.green.500)]" : "bg-red-500 animate-pulse")} />
            {connected ? "System Online" : "Reconnecting..."}
          </div>
          {hasEmergency && (
            <span className="text-[9px] text-red-400 font-mono animate-pulse">EMRG</span>
          )}
        </div>
      </div>
    </div>
  );
}
