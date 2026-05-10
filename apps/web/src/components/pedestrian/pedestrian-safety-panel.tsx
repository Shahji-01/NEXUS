import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { useTrafficStore } from "@/lib/store";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PersonStanding, CloudRain } from "lucide-react";
import { cn } from "@/lib/utils";

interface PedestrianSafetyData {
  junction_id: number;
  safety_score: number;
  risk_level: "safe" | "caution" | "danger" | "critical";
  auto_extended: boolean;
  extension_added_s: number;
  risk_factors: {
    density_risk: number;
    time_risk: number;
    weather_risk: number;
    speed_risk: number;
    total_risk: number;
  };
  recommendation: string;
}

const RISK_CONFIG = {
  safe:     { color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/40", bar: "bg-green-500",  icon: "✓" },
  caution:  { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/40",bar: "bg-yellow-500", icon: "!" },
  danger:   { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/40",bar: "bg-orange-500", icon: "⚠" },
  critical: { color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/40",   bar: "bg-red-500",   icon: "✕" },
};

const WEATHER_OPTIONS = ["clear", "cloudy", "rain", "heavy_rain", "fog"];

export function PedestrianSafetyPanel() {
  const weather = useTrafficStore(s => s.weather);
  const [data, setData] = useState<PedestrianSafetyData | null>(null);
  const [selectedWeather, setSelectedWeather] = useState("clear");
  const weatherRef = useRef(selectedWeather);
  weatherRef.current = selectedWeather;
  const fetchingRef = useRef(false);

  // Sync weather from live store once
  useEffect(() => {
    if (weather?.label) {
      const label = weather.label.toLowerCase();
      if (label.includes("rain") && label.includes("heavy")) setSelectedWeather("heavy_rain");
      else if (label.includes("rain")) setSelectedWeather("rain");
      else if (label.includes("fog")) setSelectedWeather("fog");
      else if (label.includes("cloud")) setSelectedWeather("cloudy");
      else setSelectedWeather("clear");
    }
  }, [weather?.label]);

  // Stable poll — reads current lanes from store at call time, no lane dependency
  useEffect(() => {
    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const lanes = Object.values(useTrafficStore.getState().lanes).map(l => ({
          density: l.density,
          avg_speed: l.avg_speed,
        }));
        const res = await fetch("/api/pedestrian/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ junction_id: 0, lanes, weather: weatherRef.current }),
        });
        if (res.ok) setData(await res.json() as PedestrianSafetyData);
      } catch { /* ignore */ }
      finally { fetchingRef.current = false; }
    };

    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [selectedWeather]); // only re-subscribe when weather dropdown changes

  const cfg = RISK_CONFIG[data?.risk_level ?? "safe"];
  const circumference = 2 * Math.PI * 32;

  return (
    <Card className={cn(
      "bg-card/40 backdrop-blur border transition-colors duration-1000",
      data ? cfg.border : "border-border/50"
    )}>
      <CardHeader className="py-3 px-4 border-b border-border/50 flex-row items-center gap-2 space-y-0">
        <PersonStanding className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Pedestrian Safety</h3>
        <div className="ml-auto flex items-center gap-2">
          <CloudRain className="w-3 h-3 text-muted-foreground" />
          <select
            value={selectedWeather}
            onChange={e => setSelectedWeather(e.target.value)}
            className="bg-muted/60 border border-border/60 text-muted-foreground text-[10px] rounded-md px-1.5 py-1 focus:outline-none focus:border-primary/50"
          >
            {WEATHER_OPTIONS.map(w => (
              <option key={w} value={w}>{w.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {data ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/60" />
                  <motion.circle
                    cx="40" cy="40" r="32" fill="none"
                    stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                    className={cfg.bar.replace("bg-", "text-")}
                    animate={{ strokeDasharray: `${(data.safety_score / 100) * circumference} ${circumference}` }}
                    transition={{ duration: 0.8 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn("text-xl font-bold font-mono", cfg.color)}>{data.safety_score}</span>
                  <span className="text-[9px] text-muted-foreground">/ 100</span>
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <div className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border", cfg.bg, cfg.color, cfg.border)}>
                  <span>{cfg.icon}</span>
                  <span className="capitalize">{data.risk_level}</span>
                </div>
                {data.auto_extended && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-cyan-400 font-mono bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-2.5 py-1"
                  >
                    +{data.extension_added_s}s pedestrian phase added
                  </motion.div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {Object.entries(data.risk_factors)
                .filter(([k]) => k !== "total_risk")
                .map(([factor, value]) => (
                  <div key={factor}>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span className="capitalize">{factor.replace("_risk", "").replace("_", " ")}</span>
                      <span className="font-mono">{value} pts</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className={cn("h-full rounded-full", cfg.bar)}
                        animate={{ width: `${Math.min(100, (value / 40) * 100)}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                  </div>
                ))}
            </div>

            <p className={cn("text-xs p-3 rounded-xl leading-relaxed border", cfg.bg, cfg.color, cfg.border)}>
              {data.recommendation}
            </p>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading safety data...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
