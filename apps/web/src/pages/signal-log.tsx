import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useGetSignalLog, getGetSignalLogQueryKey } from "@workspace/api-client-react";
import { Activity, Cpu, Hand, Siren, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LANE_NAMES = ["North", "South", "East", "West"];

const TRIGGER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  ai:        { label: "AI",        color: "text-blue-400",   bg: "bg-blue-500/15 border-blue-500/30",   icon: Cpu   },
  manual:    { label: "Manual",    color: "text-orange-400", bg: "bg-orange-500/15 border-orange-500/30", icon: Hand  },
  emergency: { label: "Emergency", color: "text-red-400",    bg: "bg-red-500/15 border-red-500/30",      icon: Siren },
};

const LANE_COLORS = ["text-blue-400", "text-green-400", "text-yellow-400", "text-purple-400"];

function densityBar(density: number) {
  const color =
    density >= 80 ? "bg-red-500" :
    density >= 55 ? "bg-orange-500" :
    density >= 30 ? "bg-yellow-500" :
    "bg-green-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, density)}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground tabular-nums">{density.toFixed(1)}%</span>
    </div>
  );
}

export default function SignalLog() {
  const { data, isLoading, isFetching, refetch } = useGetSignalLog(
    { limit: 200 },
    { query: { queryKey: getGetSignalLogQueryKey(), refetchInterval: 10000 } }
  );

  const logs = data?.logs ?? [];
  const summary = data?.summary;

  const statCards = [
    {
      label: "Total Events",
      value: data?.total ?? 0,
      icon: Activity,
      color: "text-foreground",
      iconBg: "bg-muted/50 border-border/60",
    },
    {
      label: "AI Triggered",
      value: summary?.ai_count ?? 0,
      icon: Cpu,
      color: "text-blue-400",
      iconBg: "bg-blue-500/10 border-blue-500/30",
    },
    {
      label: "Manual Override",
      value: summary?.manual_count ?? 0,
      icon: Hand,
      color: "text-orange-400",
      iconBg: "bg-orange-500/10 border-orange-500/30",
    },
    {
      label: "Emergency",
      value: summary?.emergency_count ?? 0,
      icon: Siren,
      color: "text-red-400",
      iconBg: "bg-red-500/10 border-red-500/30",
    },
  ];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Signal Timing Log</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Every green phase grant — AI decisions, manual overrides, and emergency preemptions</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs h-8 px-3 gap-1.5 border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {statCards.map(({ label, value, icon: Icon, color, iconBg }) => (
            <Card key={label} className="bg-card/40 backdrop-blur border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center border shrink-0", iconBg)}>
                  <Icon className={cn("w-4 h-4", color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
                  {isLoading
                    ? <Skeleton className="h-6 w-10 mt-1" />
                    : <p className={cn("text-xl font-mono leading-tight", color)}>{value}</p>
                  }
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Avg green time bar */}
        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardContent className="p-4 flex items-center gap-5">
            <div className="shrink-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Green Time Allocated</p>
              {isLoading
                ? <Skeleton className="h-7 w-16 mt-1" />
                : <p className="text-2xl font-mono font-semibold text-green-400 mt-0.5">{summary?.avg_green_sec ?? 0}s</p>
              }
            </div>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, ((summary?.avg_green_sec ?? 0) / 90) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">90s max</span>
          </CardContent>
        </Card>

        {/* Log table */}
        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">SIGNAL EVENTS</CardTitle>
              <span className="text-xs text-muted-foreground font-mono">{logs.length} records</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 flex flex-col gap-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <Cpu className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>No signal events recorded yet.</p>
                <p className="text-xs mt-1 opacity-60">Events are logged as the AI cycles through lanes.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40">
                      {["Time", "Lane", "Trigger", "Green Time", "Density at Grant"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {logs.map((log) => {
                      const t = TRIGGER_CONFIG[log.trigger] ?? TRIGGER_CONFIG["ai"];
                      const TIcon = t.icon;
                      const laneColor = LANE_COLORS[log.lane_id % 4];
                      const ts = new Date(log.timestamp);
                      const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

                      return (
                        <tr key={log.id} className="hover:bg-muted/20 transition-colors group">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {timeStr}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("font-semibold text-sm", laneColor)}>
                              {LANE_NAMES[log.lane_id % 4]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={cn("gap-1.5 text-[10px] font-medium px-2 py-0.5", t.bg, t.color, "border")}
                            >
                              <TIcon className="w-3 h-3" />
                              {t.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full bg-green-500/70 rounded-full"
                                  style={{ width: `${Math.min(100, (log.green_time_sec / 90) * 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs text-foreground tabular-nums">{log.green_time_sec}s</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {densityBar(log.density_at_time)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
