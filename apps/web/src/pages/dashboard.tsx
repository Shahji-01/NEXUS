import { Shell } from "@/components/layout/shell";
import { useTrafficStore } from "@/lib/store";
import { LaneCard } from "@/components/traffic/lane-card";
import { TrafficLight } from "@/components/traffic/traffic-light";
import { JunctionMap } from "@/components/traffic/junction-map";
import { IncidentTimeline } from "@/components/traffic/incident-timeline";
import { WeatherCard } from "@/components/weather/weather-card";
import { CongestionHeatmap } from "@/components/traffic/congestion-heatmap";
import { AiPriorityQueue } from "@/components/traffic/ai-priority-queue";
import { CarbonCounter } from "@/components/emissions/carbon-counter";
import { PedestrianSafetyPanel } from "@/components/pedestrian/pedestrian-safety-panel";
import { DemoMode } from "@/components/demo/demo-mode";
import { useGetTrafficSummary, useGetPredictions, getGetTrafficSummaryQueryKey, getGetPredictionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, Clock, Car, Cpu, PersonStanding } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";

const LANE_NAMES = ["North Bound", "South Bound", "East Bound", "West Bound"];

export default function Dashboard() {
  const { lanes, signals, connected } = useTrafficStore();

  const { data: summary, isLoading: isLoadingSummary } = useGetTrafficSummary({
    query: { queryKey: getGetTrafficSummaryQueryKey(), refetchInterval: 10000 }
  });

  const { data: predictions, isLoading: isLoadingPredictions } = useGetPredictions({
    query: { queryKey: getGetPredictionsQueryKey(), refetchInterval: 30000 }
  });

  return (
    <Shell>
      <div className="space-y-5">

        {/* Demo walkthrough */}
        <DemoMode />

        {/* KPI stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Vehicles Today", value: isLoadingSummary ? null : summary?.total_vehicles_today?.toLocaleString(), icon: Car, color: "blue" },
            { label: "Avg Density", value: isLoadingSummary ? null : `${summary?.avg_density?.toFixed(1)}%`, icon: Activity, color: "orange" },
            { label: "Peak Hour", value: isLoadingSummary ? null : `${String(summary?.peak_hour ?? 0).padStart(2, "0")}:00`, icon: Clock, color: "green" },
            { label: "Critical Events", value: isLoadingSummary ? null : String(summary?.critical_events_today ?? 0), icon: AlertTriangle, color: "red" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/40 backdrop-blur border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border bg-${color}-500/10 border-${color}-500/30`}>
                  <Icon className={`w-4 h-4 text-${color}-400`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
                  {value == null ? <Skeleton className="h-6 w-16 mt-1" /> : (
                    <p className="text-xl font-mono leading-tight">{value}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Left: Lane cards 2×2 */}
          <div className="xl:col-span-2 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                LIVE LANE STATUS
              </h3>
              {signals?.ai_mode && (
                <Badge variant="outline" className="text-primary border-primary/30 gap-1 text-[10px]">
                  <Cpu className="w-3 h-3" /> AI OPTIMIZED
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((id) => (
                <motion.div key={id} layout>
                  <LaneCard
                    name={LANE_NAMES[id]}
                    lane={lanes[id] ?? { lane_id: id, vehicle_count: 0, density: 0, cars: 0, bikes: 0, trucks: 0, buses: 0, avg_speed: 0, congestion_level: "low" }}
                  />
                </motion.div>
              ))}
            </div>

            {/* Congestion heatmap */}
            <CongestionHeatmap />

            {/* Prediction area chart */}
            <Card className="bg-card/40 backdrop-blur border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">CONGESTION FORECAST — NEXT 15 MIN</CardTitle>
              </CardHeader>
              <CardContent className="h-[220px]">
                {isLoadingPredictions ? (
                  <Skeleton className="w-full h-full rounded-md" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={predictions?.predictions ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="p5" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="p10" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="p15" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="lane_id"
                        tickFormatter={v => ["N","S","E","W"][Number(v)] ?? v}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0, 100]} tickFormatter={v => `${v}%`} width={34} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', fontSize: 11 }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                        formatter={(val: number, name: string) => {
                          const labels: Record<string, string> = { prediction_5min: "+5 min", prediction_10min: "+10 min", prediction_15min: "+15 min" };
                          return [`${val}%`, labels[name] ?? name];
                        }}
                        labelFormatter={v => `Lane: ${["North","South","East","West"][Number(v)] ?? v}`}
                      />
                      <Area type="monotone" dataKey="prediction_5min" stroke="#22c55e" fill="url(#p5)" strokeWidth={1.5} dot={{ r: 3, fill: "#22c55e" }} />
                      <Area type="monotone" dataKey="prediction_10min" stroke="hsl(var(--primary))" fill="url(#p10)" strokeWidth={1.5} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                      <Area type="monotone" dataKey="prediction_15min" stroke="#f97316" fill="url(#p15)" strokeWidth={1.5} dot={{ r: 3, fill: "#f97316" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Carbon counter */}
            <CarbonCounter />

            {/* Pedestrian safety */}
            <PedestrianSafetyPanel />
          </div>

          {/* Right column: Signal grid + Junction map + Camera */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
              SIGNAL GRID
            </h3>
            <Card className="bg-card/40 backdrop-blur border-border/50">
              <CardContent className="p-5">
                <div className="grid grid-cols-2 gap-6 justify-items-center">
                  {[0, 1, 2, 3].map((id) => (
                    <div key={id} className="flex flex-col items-center gap-2">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">{LANE_NAMES[id]}</span>
                      <TrafficLight
                        phase={signals?.phases?.[id] ?? "red"}
                        timeRemaining={signals?.current_green === id ? signals?.time_remaining : undefined}
                        emergency={!!(signals?.emergency_active && signals?.emergency_lane === id)}
                      />
                    </div>
                  ))}
                </div>
                {!!(signals as unknown as Record<string, unknown>)?.["pedestrian_walk_active"] && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-cyan-400 text-xs font-semibold animate-pulse border border-cyan-500/30 bg-cyan-500/10 rounded-lg py-2">
                    <PersonStanding className="w-4 h-4" />
                    PEDESTRIAN WALK ACTIVE — {((signals as unknown as Record<string, unknown>)?.["pedestrian_walk_remaining"] as number) ?? 0}s
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/40 backdrop-blur border-border/50">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">JUNCTION MAP</CardTitle>
              </CardHeader>
              <CardContent className="p-3 h-[280px]">
                <JunctionMap />
              </CardContent>
            </Card>

            <AiPriorityQueue />
            <WeatherCard />

            <Card className="bg-card/40 backdrop-blur border-border/50 flex flex-col" style={{ minHeight: 280 }}>
              <CardContent className="p-4 flex-1 flex flex-col min-h-0">
                <IncidentTimeline />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
