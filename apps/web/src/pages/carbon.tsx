import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, LineChart, Line,
} from "recharts";
import { Leaf, Fuel, TreeDeciduous, Car, TrendingDown, Zap } from "lucide-react";

import { API_URL as BASE } from "@/lib/api";

interface Snapshot {
  current_idle_pct: number;
  baseline_idle_pct: number;
  co2_saved_kg_total: number;
  co2_saved_kg_today: number;
  trees_equivalent: number;
  cars_removed_equivalent: number;
  idle_time_saved_s_today: number;
}

interface HistoryPoint {
  ts: number;
  label: string;
  co2_saved_g: number;
  idle_saved_s: number;
  idle_pct: number;
}

const tooltipStyle = {
  contentStyle: { backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "11px" },
  itemStyle: { color: "hsl(var(--foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

function StatCard({
  label, value, sub, icon: Icon, color, loading,
}: { label: string; value: string; sub?: string; icon: React.ElementType; color: string; loading?: boolean }) {
  return (
    <Card className="bg-card/40 backdrop-blur border-border/50">
      <CardContent className="p-5">
        {loading ? <Skeleton className="h-14 w-full" /> : (
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
              {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
            </div>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${color}-500/10 border border-${color}-500/30`}>
              <Icon className={`w-4 h-4 text-${color}-400`} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CarbonPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const histRef = useRef<HistoryPoint[]>([]);
  const prevSnap = useRef<Snapshot | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch(`${BASE}/emissions/snapshot`)
        .then(r => r.json())
        .then((d: Snapshot) => {
          setSnapshot(d);
          const now = Date.now();
          const saved_g = prevSnap.current
            ? Math.max(0, (d.co2_saved_kg_total - prevSnap.current.co2_saved_kg_total) * 1000)
            : 0;
          const idle_saved = prevSnap.current
            ? Math.max(0, d.idle_time_saved_s_today - prevSnap.current.idle_time_saved_s_today)
            : 0;
          prevSnap.current = d;

          const point: HistoryPoint = {
            ts: now,
            label: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            co2_saved_g: Math.round(saved_g * 1000) / 1000,
            idle_saved_s: Math.round(idle_saved * 10) / 10,
            idle_pct: d.current_idle_pct,
          };

          histRef.current = [...histRef.current, point].slice(-60);
          setHistory([...histRef.current]);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const fuelSavedL = snapshot ? Math.round((snapshot.co2_saved_kg_today / 2.31) * 100) / 100 : 0;
  const idleMin = snapshot ? Math.round(snapshot.idle_time_saved_s_today / 60) : 0;
  const reduction = snapshot
    ? Math.round(((snapshot.baseline_idle_pct - snapshot.current_idle_pct) / snapshot.baseline_idle_pct) * 100)
    : 0;

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <Leaf className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Carbon & Fuel Savings</h2>
            <p className="text-xs text-muted-foreground">Real-time environmental impact of AI signal optimisation</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-green-400 font-mono">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
            LIVE
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="CO₂ Saved Today" value={snapshot ? `${snapshot.co2_saved_kg_today.toFixed(3)} kg` : "—"} sub="vs fixed-signal baseline" icon={Leaf} color="green" loading={!snapshot} />
          <StatCard label="CO₂ Saved Total" value={snapshot ? `${snapshot.co2_saved_kg_total.toFixed(3)} kg` : "—"} sub="since system start" icon={TrendingDown} color="emerald" loading={!snapshot} />
          <StatCard label="Fuel Saved Today" value={snapshot ? `${fuelSavedL} L` : "—"} sub="petrol equivalent" icon={Fuel} color="orange" loading={!snapshot} />
          <StatCard label="Trees Equivalent" value={snapshot ? `${snapshot.trees_equivalent.toFixed(1)}` : "—"} sub="daily CO₂ offset" icon={TreeDeciduous} color="lime" loading={!snapshot} />
          <StatCard label="Cars Off Road" value={snapshot ? `${snapshot.cars_removed_equivalent.toFixed(2)}` : "—"} sub="annual equivalent" icon={Car} color="blue" loading={!snapshot} />
          <StatCard label="Idle Time Saved" value={snapshot ? `${idleMin} min` : "—"} sub={`${reduction}% reduction today`} icon={Zap} color="yellow" loading={!snapshot} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Idle Time — AI vs Baseline</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {history.length < 2 ? (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Collecting data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} domain={[0, 60]} unit="%" />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="idle_pct" name="AI Idle %" stroke="#22d3ee" fill="#22d3ee22" strokeWidth={2} dot={false} />
                    {history.length > 0 && (
                      <Area
                        type="monotone"
                        data={history.map(h => ({ ...h, baseline: snapshot?.baseline_idle_pct ?? 55 }))}
                        dataKey="baseline"
                        name="Baseline Idle %"
                        stroke="#f97316"
                        fill="#f9731611"
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        dot={false}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/40 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">CO₂ Saved per Tick (grams)</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {history.length < 2 ? (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Collecting data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={history.slice(-30)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="co2_saved_g" name="CO₂ Saved (g)" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Cumulative Idle Time Saved Today (seconds)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            {history.length < 2 ? (
              <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Collecting data…</div>
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="idle_saved_s" name="Idle Saved (s)" stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 text-xs text-muted-foreground space-y-2">
            <p>The AI signal optimizer reduces unnecessary idle time by dynamically allocating green phases based on real-time density and bus priority. Compared to a fixed-signal baseline (55% idle fraction), every percentage point of idle time saved directly translates to lower fuel consumption and CO₂ emissions.</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {[
                { label: "Emission factor", value: "0.05 g CO₂/s per vehicle idle" },
                { label: "Baseline idle", value: "55% of vehicles idling at any time" },
                { label: "Tree offset", value: "1 tree absorbs ~21.7 kg CO₂/year" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/20 rounded-lg p-3">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60">{label}</p>
                  <p className="text-xs font-medium mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
