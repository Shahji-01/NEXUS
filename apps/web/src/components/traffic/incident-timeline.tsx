import { useTrafficStore, type AlertItem } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, Siren, Zap, Cpu, Trash2, Radio, CloudRain,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const LANE_LABELS: Record<number, string> = {
  0: "N", 1: "S", 2: "E", 3: "W",
};

const TYPE_CONFIG: Record<AlertItem["type"], {
  icon: React.ElementType;
  borderColor: string;
  iconColor: string;
  bgColor: string;
}> = {
  emergency: {
    icon: Siren,
    borderColor: "border-l-red-500",
    iconColor: "text-red-400",
    bgColor: "bg-red-500/8",
  },
  congestion: {
    icon: AlertTriangle,
    borderColor: "border-l-orange-500",
    iconColor: "text-orange-400",
    bgColor: "bg-orange-500/8",
  },
  recovery: {
    icon: CheckCircle2,
    borderColor: "border-l-green-500",
    iconColor: "text-green-400",
    bgColor: "bg-green-500/8",
  },
  resolution: {
    icon: CheckCircle2,
    borderColor: "border-l-green-400",
    iconColor: "text-green-400",
    bgColor: "bg-green-500/8",
  },
  signal_override: {
    icon: Zap,
    borderColor: "border-l-blue-500",
    iconColor: "text-blue-400",
    bgColor: "bg-blue-500/8",
  },
  system: {
    icon: Cpu,
    borderColor: "border-l-primary",
    iconColor: "text-primary",
    bgColor: "bg-primary/8",
  },
  weather: {
    icon: CloudRain,
    borderColor: "border-l-sky-500",
    iconColor: "text-sky-400",
    bgColor: "bg-sky-500/8",
  },
};

function TimeAgo({ ts }: { ts: string }) {
  return (
    <span className="text-[9px] text-muted-foreground/60 font-mono tabular-nums">
      {formatDistanceToNow(new Date(ts), { addSuffix: true })}
    </span>
  );
}

function IncidentRow({ item }: { item: AlertItem }) {
  const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.system;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 12, height: 0 }}
      animate={{ opacity: 1, x: 0, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "border-l-2 pl-3 pr-2 py-2.5 rounded-r-md transition-colors",
        cfg.borderColor,
        cfg.bgColor,
        !item.read && "ring-1 ring-inset ring-white/5"
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", cfg.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] font-medium leading-tight text-foreground truncate">
              {item.title}
            </p>
            {item.lane !== undefined && (
              <span className={cn(
                "text-[8px] font-mono px-1 py-0.5 rounded shrink-0 font-bold",
                cfg.iconColor, "bg-current/10"
              )}>
                {LANE_LABELS[item.lane] ?? `L${item.lane}`}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight truncate">
            {item.description}
          </p>
          <TimeAgo ts={item.timestamp} />
        </div>
      </div>
    </motion.div>
  );
}

export function IncidentTimeline() {
  const { alerts, clearAlerts, connected } = useTrafficStore();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio className={cn(
            "w-3.5 h-3.5",
            connected ? "text-primary animate-pulse" : "text-muted-foreground"
          )} />
          <span className="text-xs font-semibold tracking-widest text-muted-foreground">
            INCIDENT FEED
          </span>
          {alerts.length > 0 && (
            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-mono">
              {alerts.length}
            </span>
          )}
        </div>
        {alerts.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAlerts}
            className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-muted-foreground"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-0.5 scrollbar-thin">
        <AnimatePresence initial={false}>
          {alerts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-32 text-center"
            >
              <CheckCircle2 className="w-6 h-6 text-green-500/40 mb-2" />
              <p className="text-[10px] text-muted-foreground/50">No incidents</p>
              <p className="text-[9px] text-muted-foreground/30 mt-0.5">System nominal</p>
            </motion.div>
          ) : (
            alerts.map(item => (
              <IncidentRow key={item.id} item={item} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
