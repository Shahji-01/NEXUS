import { useEffect, useState, useRef } from "react";
import { API_URL } from "@/lib/api";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Leaf, TreePine, Car, Timer } from "lucide-react";

interface EmissionsSnapshot {
  current_idle_pct: number;
  baseline_idle_pct: number;
  co2_saved_kg_today: number;
  trees_equivalent: number;
  cars_removed_equivalent: number;
  idle_time_saved_s_today: number;
}

function CountUp({ value, decimals = 1, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    const steps = 25;
    const stepVal = (value - from) / steps;
    let current = from;
    let count = 0;
    const timer = setInterval(() => {
      count++;
      current += stepVal;
      if (count >= steps) {
        setDisplay(value);
        clearInterval(timer);
      } else {
        setDisplay(current);
      }
    }, 20);
    return () => clearInterval(timer);
  }, [value]);

  return <>{display.toFixed(decimals)}{suffix}</>;
}

export function CarbonCounter() {
  const [data, setData] = useState<EmissionsSnapshot | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/emissions/snapshot`)
        .then(r => r.ok ? r.json() as Promise<EmissionsSnapshot> : null)
        .then(d => { if (d) setData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;

  const reduction = Math.max(0, data.baseline_idle_pct - data.current_idle_pct);

  const stats = [
    { icon: Leaf,     label: "CO₂ saved today",        value: <CountUp value={data.co2_saved_kg_today} decimals={2} suffix=" kg" />, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { icon: TreePine, label: "Trees equivalent",        value: <CountUp value={data.trees_equivalent} decimals={1} />,              color: "text-green-400",   bg: "bg-green-500/10 border-green-500/20" },
    { icon: Car,      label: "Cars removed equiv.",     value: <CountUp value={data.cars_removed_equivalent} decimals={2} />,       color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
    { icon: Timer,    label: "Idle time saved/vehicle", value: <CountUp value={data.idle_time_saved_s_today} decimals={0} suffix="s" />, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  ];

  return (
    <Card className="bg-card/40 backdrop-blur border-border/50">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex-row items-center gap-2 space-y-0">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <h3 className="text-sm font-semibold">Live Carbon Impact</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">vs fixed-signal baseline</span>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
            <span>Current idle: {data.current_idle_pct}%</span>
            <span className="text-emerald-400">−{reduction.toFixed(1)}% vs baseline ({data.baseline_idle_pct}%)</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden relative">
            <div className="h-full bg-red-700/40 rounded-full absolute top-0 left-0"
              style={{ width: `${data.baseline_idle_pct}%` }} />
            <motion.div
              className="h-full bg-emerald-500 rounded-full absolute top-0 left-0"
              animate={{ width: `${data.current_idle_pct}%` }}
              transition={{ duration: 1 }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {stats.map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`border rounded-xl p-3 ${bg}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
              <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground/50 text-center">
          Session accumulator · Updates every 2s · Resets at midnight
        </p>
      </CardContent>
    </Card>
  );
}
