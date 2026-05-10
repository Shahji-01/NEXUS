import { useTrafficStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger
} from "@/components/ui/popover";
import { Wifi, WifiOff, Bell, BellRing, CheckCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { WeatherBadge } from "@/components/weather/weather-badge";

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-blue-400",
  warning: "bg-orange-400",
  critical: "bg-red-400",
};

const SEVERITY_ICON: Record<string, string> = {
  info: "✅",
  warning: "🟠",
  critical: "🔴",
};

export function Header() {
  const { connected, lastUpdate, alerts, unreadCount, markAllRead, clearAlerts } = useTrafficStore();

  return (
    <header className="h-16 border-b bg-card/50 backdrop-blur flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground">AI JUNCTION OPTIMIZER</h2>
      </div>

      <div className="flex items-center gap-3">
        {lastUpdate && (
          <div className="text-xs text-muted-foreground font-mono hidden sm:block">
            LAST SYNC: {new Date(lastUpdate).toLocaleTimeString()}
          </div>
        )}
        <WeatherBadge />

        {/* Notification bell */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative w-8 h-8 rounded-full"
              onClick={markAllRead}
            >
              <AnimatePresence mode="wait">
                {unreadCount > 0 ? (
                  <motion.span key="ring" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                    <BellRing className="w-4 h-4 text-orange-400" />
                  </motion.span>
                ) : (
                  <motion.span key="bell" initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
                    <Bell className="w-4 h-4 text-muted-foreground" />
                  </motion.span>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {unreadCount > 0 && (
                  <motion.span
                    key="badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            className="w-80 p-0 bg-card border-border/60 shadow-xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold tracking-wider text-muted-foreground">ALERTS</span>
                {alerts.length > 0 && (
                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-mono">
                    {alerts.length}
                  </span>
                )}
              </div>
              {alerts.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-6 h-6 text-muted-foreground hover:text-destructive"
                  onClick={clearAlerts}
                  title="Clear all alerts"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-border/30">
              {alerts.length === 0 ? (
                <div className="py-10 text-center">
                  <CheckCheck className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No alerts yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Monitoring all 4 lanes</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className={cn(
                    "px-4 py-3 flex gap-3 transition-colors",
                    !alert.read && "bg-muted/30"
                  )}>
                    <div className="text-base leading-none mt-0.5 shrink-0">
                      {SEVERITY_ICON[alert.severity]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-snug truncate">{alert.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{alert.description}</p>
                      <p className="text-[9px] text-muted-foreground/50 mt-1 font-mono">
                        {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                    <div className={cn("w-1.5 h-1.5 rounded-full mt-1 shrink-0", SEVERITY_DOT[alert.severity])} />
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Badge
          variant={connected ? "default" : "destructive"}
          className="gap-1.5 rounded-full font-mono text-[10px]"
        >
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {connected ? "DATA STREAM LIVE" : "DISCONNECTED"}
        </Badge>
      </div>
    </header>
  );
}
