import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { Bus, Users, Clock, TrendingUp, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import { API_URL as BASE } from "@/lib/api";

interface LaneStat {
  lane_id: number;
  lane_name: string;
  bus_count: number;
  bus_pct: number;
  priority_active: boolean;
  estimated_passengers: number;
  avg_speed: number;
  density: number;
  on_time_pct: number;
  delay_s: number;
}

interface TransitStatus {
  lane_stats: LaneStat[];
  priority_lane: number | null;
  priority_boost: number;
  total_buses: number;
  estimated_passengers: number;
  fleet_on_time_pct: number;
  time_saved_s_per_bus: number;
  generated_at: string;
}

const LANE_COLORS = ["#3b82f6", "#22d3ee", "#a78bfa", "#f97316"];

const tooltipStyle = {
  contentStyle: { backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "11px" },
  itemStyle: { color: "hsl(var(--foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

export default function TransitPage() {
  const [data, setData] = useState<TransitStatus | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch(`${BASE}/transit/status`)
        .then(r => r.json())
        .then(setData)
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const stats = data?.lane_stats ?? [];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
            <Bus className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Public Transit Priority</h2>
            <p className="text-xs text-muted-foreground">Bus lanes receive AI pressure-score boost — less delay, more on-time arrivals</p>
          </div>
          {data?.priority_lane !== null && data?.priority_lane !== undefined ? (
            <Badge className="ml-auto bg-blue-500/20 text-blue-400 border-blue-500/40 animate-pulse">
              PRIORITY ACTIVE — {stats[data.priority_lane]?.lane_name}
            </Badge>
          ) : (
            <Badge className="ml-auto bg-muted/30 text-muted-foreground border-border/40">
              NO PRIORITY LANE
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Buses", value: data ? String(data.total_buses) : "—", icon: Bus, color: "blue" },
            { label: "Passengers Est.", value: data ? data.estimated_passengers.toLocaleString() : "—", icon: Users, color: "cyan" },
            { label: "Fleet On-Time", value: data ? `${data.fleet_on_time_pct}%` : "—", icon: CheckCircle2, color: "green" },
            { label: "Time Saved / Bus", value: data ? `${data.time_saved_s_per_bus}s` : "—", icon: Clock, color: "orange" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/40 border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${color}-500/10 border border-${color}-500/30`}>
                  <Icon className={`w-4 h-4 text-${color}-400`} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold tabular-nums mt-0.5">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Bus Count by Lane</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="lane_name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="bus_count" name="Buses" radius={[4, 4, 0, 0]}>
                    {stats.map((_, i) => (
                      <Cell key={i} fill={LANE_COLORS[i] ?? "#3b82f6"} opacity={data?.priority_lane === i ? 1 : 0.6} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">On-Time Performance by Lane (%)</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="lane_name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="on_time_pct" name="On-Time %" radius={[4, 4, 0, 0]}>
                    {stats.map((s, i) => (
                      <Cell key={i} fill={s.on_time_pct >= 80 ? "#22c55e" : s.on_time_pct >= 65 ? "#f59e0b" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Lane Detail</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stats.map((lane, i) => (
              <motion.div key={lane.lane_id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={cn(
                  "border transition-colors",
                  lane.priority_active ? "border-blue-500/50 bg-blue-500/5" : "bg-card/40 border-border/50",
                )}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: LANE_COLORS[i] }} />
                        <span className="font-semibold text-sm">{lane.lane_name}</span>
                      </div>
                      {lane.priority_active && (
                        <Badge className="text-[9px] bg-blue-500/20 text-blue-400 border-blue-500/40 px-1.5 py-0">
                          PRIORITY
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { label: "Buses", value: String(lane.bus_count) },
                        { label: "Passengers", value: lane.estimated_passengers.toLocaleString() },
                        { label: "Bus %", value: `${lane.bus_pct.toFixed(1)}%` },
                        { label: "Speed", value: `${lane.avg_speed} km/h` },
                        { label: "Density", value: `${lane.density.toFixed(1)}%` },
                        { label: "Delay", value: `${lane.delay_s}s` },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">{label}</p>
                          <p className="font-mono font-medium">{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="text-muted-foreground">On-time performance</span>
                        <span className={lane.on_time_pct >= 80 ? "text-green-400" : lane.on_time_pct >= 65 ? "text-yellow-400" : "text-red-400"}>
                          {lane.on_time_pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500",
                            lane.on_time_pct >= 80 ? "bg-green-500" : lane.on_time_pct >= 65 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${lane.on_time_pct}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Priority Algorithm</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-xs text-muted-foreground space-y-1">
            <p>When a lane has <strong className="text-foreground">2 or more buses</strong> representing <strong className="text-foreground">&gt;6%</strong> of its traffic, the AI applies a <strong className="text-foreground">1.5× pressure-score multiplier</strong> during lane selection — effectively giving buses priority in the green-phase queue without manual intervention.</p>
            <p>This reduces per-bus signal delay by an average of <strong className="text-foreground">8–15 seconds</strong>, improving on-time performance by 12–18% for routes serving this junction.</p>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
