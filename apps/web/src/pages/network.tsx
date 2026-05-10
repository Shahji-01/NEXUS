import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Network, Zap, TrendingUp, Wind, Timer, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { NetworkFlowMap, NetworkScore } from "@/components/network/network-flow-map";

import { API_URL as BASE } from "@/lib/api";

interface JunctionNode {
  id: number;
  name: string;
  distance_m: number;
  density: number;
  avg_speed: number;
  congestion_level: string;
  current_phase: "green" | "yellow" | "red";
  green_offset_s: number;
  vehicles_queued: number;
  throughput_pct: number;
  delay_s: number;
}

interface NetworkState {
  junctions: JunctionNode[];
  wave_config: { target_speed_kmh: number; wave_direction: string; enabled: boolean };
  total_delay_s: number;
  avg_throughput_pct: number;
  co2_saved_vs_uncoordinated_pct: number;
  wave_efficiency_pct: number;
  generated_at: string;
}

const LEVEL_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

const tooltipStyle = {
  contentStyle: { backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "11px" },
  itemStyle: { color: "hsl(var(--foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

function networkScore(data: NetworkState): number {
  const delayPenalty = Math.max(0, 100 - data.total_delay_s * 1.5);
  return Math.round(
    0.35 * data.avg_throughput_pct +
    0.35 * data.wave_efficiency_pct +
    0.30 * delayPenalty
  );
}

export default function NetworkPage() {
  const [data, setData] = useState<NetworkState | null>(null);
  const [speed, setSpeed] = useState(40);

  useEffect(() => {
    const poll = () => {
      fetch(`${BASE}/network/state`)
        .then(r => r.json())
        .then((d: NetworkState) => { setData(d); setSpeed(d.wave_config.target_speed_kmh); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const setWaveConfig = (updates: Record<string, unknown>) => {
    fetch(`${BASE}/network/wave-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).catch(() => {});
  };

  const junctions = data?.junctions ?? [];
  const score = data ? networkScore(data) : 0;

  return (
    <Shell>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
            <Network className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Multi-Junction Network Optimizer</h2>
            <p className="text-xs text-muted-foreground">Green wave coordination across 5 junctions — live animated corridor view</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {data?.wave_config.enabled ? (
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/40">WAVE ACTIVE</Badge>
            ) : (
              <Badge className="bg-muted/30 text-muted-foreground border-border/40">WAVE DISABLED</Badge>
            )}
          </div>
        </div>

        {/* Score + KPI row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch">

          {/* Network Score gauge */}
          <Card className="bg-card/40 border-border/50 flex items-center justify-center py-3 md:col-span-1">
            <CardContent className="p-0">
              <NetworkScore score={score} />
            </CardContent>
          </Card>

          {/* 4 KPI cards */}
          <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Wave Efficiency", value: data ? `${data.wave_efficiency_pct}%` : "—", icon: Zap, color: "purple" },
              { label: "Avg Throughput", value: data ? `${data.avg_throughput_pct.toFixed(1)}%` : "—", icon: TrendingUp, color: "cyan" },
              { label: "CO₂ Saved", value: data ? `${data.co2_saved_vs_uncoordinated_pct}%` : "—", icon: Wind, color: "green" },
              { label: "Total Delay", value: data ? `${data.total_delay_s.toFixed(1)}s` : "—", icon: Timer, color: "orange" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="bg-card/40 border-border/50">
                <CardContent className="p-4 flex items-center gap-3 h-full">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${color}-500/10 border border-${color}-500/30 flex-shrink-0`}>
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
        </div>

        {/* ── Live Animated Corridor Map ── */}
        <Card className="bg-card/40 border-border/50 overflow-hidden">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Live Corridor Flow Map</CardTitle>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  particles = vehicle flow
                </span>
                <span>color = congestion</span>
                <span>NB → / ← SB</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-5 pt-1">
            <NetworkFlowMap junctions={junctions} />
          </CardContent>
        </Card>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Throughput by Junction (%)</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={junctions}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="throughput_pct" name="Throughput %" radius={[4, 4, 0, 0]}>
                    {junctions.map((j, i) => (
                      <Cell key={i} fill={LEVEL_COLOR[j.congestion_level] ?? "#22c55e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Delay by Junction (seconds)</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={junctions}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} unit="s" />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="delay_s" name="Delay (s)" radius={[4, 4, 0, 0]}>
                    {junctions.map((j, i) => (
                      <Cell key={i} fill={j.delay_s > 30 ? "#ef4444" : j.delay_s > 15 ? "#f97316" : "#22c55e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Wave Configuration */}
        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Wave Configuration</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase tracking-widest">Target Speed</label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => { const s = Math.max(20, speed - 5); setSpeed(s); setWaveConfig({ target_speed_kmh: s }); }}>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                  <span className="text-lg font-bold tabular-nums w-16 text-center">{speed} km/h</span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => { const s = Math.min(70, speed + 5); setSpeed(s); setWaveConfig({ target_speed_kmh: s }); }}>
                    <ChevronUp className="w-3 h-3" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Particle speed and offset timing calculated from this</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase tracking-widest">Wave Direction</label>
                <div className="flex gap-1">
                  {(["northbound", "southbound", "both"] as const).map(dir => (
                    <Button
                      key={dir}
                      variant={data?.wave_config.wave_direction === dir ? "default" : "outline"}
                      size="sm"
                      className="text-[10px] h-7 px-2 capitalize"
                      onClick={() => setWaveConfig({ wave_direction: dir })}
                    >
                      {dir}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase tracking-widest">Green Wave</label>
                <Button
                  variant={data?.wave_config.enabled ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-3 text-[11px]"
                  onClick={() => setWaveConfig({ enabled: !data?.wave_config.enabled })}
                >
                  {data?.wave_config.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Junction detail cards */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Junction Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {junctions.map((j, idx) => (
              <motion.div key={j.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                <Card className="bg-card/40 border-border/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: { green: "#22c55e", yellow: "#eab308", red: "#ef4444" }[j.current_phase] }} />
                      <span className="font-semibold text-sm flex-1">{j.name}</span>
                      <span className="text-[9px] text-muted-foreground font-mono">{j.distance_m}m</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { label: "Density", value: `${j.density.toFixed(1)}%` },
                        { label: "Speed", value: `${j.avg_speed.toFixed(1)} km/h` },
                        { label: "Queued", value: String(j.vehicles_queued) },
                        { label: "Throughput", value: `${j.throughput_pct.toFixed(1)}%` },
                        { label: "Delay", value: `${j.delay_s.toFixed(1)}s` },
                        { label: "Offset", value: `+${j.green_offset_s}s` },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">{label}</p>
                          <p className="font-mono font-medium text-xs">{value}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
