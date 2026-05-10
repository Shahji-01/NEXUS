import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Waves, Car, Clock, ArrowRight, Zap, Leaf, Timer, TrendingDown } from "lucide-react";

const DEMO_CORRIDOR = [
  { id: 0, name: "Gandhi Chowk",    distance_m: 0    },
  { id: 1, name: "MG Road Cross",   distance_m: 300  },
  { id: 2, name: "Station Circle",  distance_m: 600  },
  { id: 3, name: "Nehru Square",    distance_m: 900  },
  { id: 4, name: "Airport Gate",    distance_m: 1200 },
];

interface JunctionLiveState {
  junction_id: number;
  name: string;
  position_m: number;
  phase: "green" | "yellow" | "red";
  phase_elapsed_s: number;
  offset_s: number;
  green_duration_s: number;
  cycle_length_s: number;
}

interface CorridorLiveState {
  corridor_id: string;
  name: string;
  target_speed_kmh: number;
  wave_active: boolean;
  global_time_s: number;
  junctions: JunctionLiveState[];
  savings: {
    stops_reduced_pct: number;
    idle_time_saved_s: number;
    co2_saved_kg_per_vehicle: number;
    co2_saved_kg_daily: number;
    trees_equivalent_daily: number;
    travel_time_improvement_pct: number;
  };
  total_length_m: number;
}

function computeOffsets(speedKmh: number, cycleSec: number) {
  const speedMs = (speedKmh * 1000) / 3600;
  return DEMO_CORRIDOR.map((j) => {
    const travelSec = j.distance_m / speedMs;
    const offset = travelSec % cycleSec;
    return { ...j, travel_sec: Math.round(travelSec * 10) / 10, offset_sec: Math.round(offset * 10) / 10 };
  });
}

function formatTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const PHASE_COLORS = {
  green:  { fill: "#16a34a", glow: "#16a34a40", text: "text-green-400" },
  yellow: { fill: "#ca8a04", glow: "#ca8a0440", text: "text-yellow-400" },
  red:    { fill: "#dc2626", glow: "#dc262640", text: "text-red-400" },
};

export default function GreenWave() {
  const [speed, setSpeed] = useState(50);
  const [cycle, setCycle] = useState(90);
  const [tick, setTick] = useState(0);
  const [liveData, setLiveData] = useState<CorridorLiveState | null>(null);
  const tickRef = useRef(0);
  const lastFetchRef = useRef(0);

  const junctions = computeOffsets(speed, cycle);
  const speedMs = (speed * 1000) / 3600;
  const totalDistance = DEMO_CORRIDOR[DEMO_CORRIDOR.length - 1].distance_m;
  const totalTravelSec = totalDistance / speedMs;

  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current = (tickRef.current + 1) % (cycle * 5);
      setTick(tickRef.current);
    }, 200);
    return () => clearInterval(id);
  }, [cycle]);

  // Fetch live corridor state from backend — throttled to once every 2 seconds
  useEffect(() => {
    const now = Date.now();
    if (now - lastFetchRef.current < 2000) return;
    lastFetchRef.current = now;
    fetch("/api/corridor/status")
      .then(r => r.ok ? r.json() as Promise<CorridorLiveState> : null)
      .then(d => { if (d) setLiveData(d); })
      .catch(() => {});
  }, [tick]);

  // Sync speed changes to backend
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/corridor/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_kmh: speed }),
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [speed]);

  const vehicleProgress = Math.min(1, (tick / 5) / totalTravelSec);
  const vehicleTimeInCycle = (tick / 5) % cycle;

  const savings = liveData?.savings;

  return (
    <Shell>
      <div className="space-y-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2 text-primary">
              <Waves className="w-5 h-5" />
              Green Wave Corridor Sync
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Phase offsets computed so a vehicle at target speed hits green at every junction — no stops.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono bg-primary/10 border border-primary/20 rounded-lg px-4 py-2">
            <span className={`font-bold ${liveData?.wave_active ? "text-green-400" : "text-primary"}`}>
              {liveData?.wave_active ? "⬤ WAVE ACTIVE" : "○ SYNCING"}
            </span>
            <span>·</span>
            <span>{speed} km/h target</span>
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs tracking-widest text-muted-foreground flex items-center gap-2">
                <Car className="w-3.5 h-3.5" /> CORRIDOR SPEED
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-3xl font-bold font-mono text-primary">{speed}</span>
                <span className="text-muted-foreground text-sm">km/h</span>
              </div>
              <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={20} max={90} step={5} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>20 km/h</span><span>90 km/h</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs tracking-widest text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" /> CYCLE LENGTH
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-3xl font-bold font-mono text-primary">{cycle}</span>
                <span className="text-muted-foreground text-sm">seconds</span>
              </div>
              <Slider value={[cycle]} onValueChange={([v]) => setCycle(v)} min={40} max={300} step={10} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>40s (quiet)</span><span>300s (peak)</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Animated SVG Wave Corridor */}
        <Card className="bg-card/40 backdrop-blur border-border/50 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs tracking-widest text-muted-foreground">LIVE WAVE ANIMATION — 5 JUNCTIONS</CardTitle>
          </CardHeader>
          <CardContent className="pb-6">
            {liveData ? (
              <svg viewBox="0 0 900 240" width="100%" className="overflow-visible">
                {/* Road surface */}
                <rect x="40" y="95" width="820" height="50" rx="6" fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth="1" opacity="0.6" />
                {/* Centre dashes */}
                {Array.from({ length: 22 }).map((_, i) => (
                  <rect key={i} x={60 + i * 37} y="119" width="20" height="2" fill="hsl(var(--border))" rx="1" opacity="0.5" />
                ))}
                {/* Direction label */}
                <text x="50" y="88" fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="monospace">
                  ▶ {speed} km/h target · {(totalDistance / 1000).toFixed(1)} km corridor
                </text>

                {/* Junctions */}
                {liveData.junctions.map((j) => {
                  const xPct = j.position_m / totalDistance;
                  const x = 60 + xPct * 780;
                  const c = PHASE_COLORS[j.phase] ?? PHASE_COLORS.red;
                  const greenPct = j.phase === "green"
                    ? Math.min(100, (j.phase_elapsed_s / j.green_duration_s) * 100)
                    : 0;
                  return (
                    <g key={j.junction_id}>
                      {/* Glow halo */}
                      <motion.circle cx={x} cy="120" r={26} fill={c.glow}
                        animate={{ opacity: [0.2, 0.55, 0.2], scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        style={{ transformOrigin: `${x}px 120px` }}
                      />
                      {/* Light post */}
                      <rect x={x - 8} y="90" width="16" height="55" fill={c.fill} rx="3" opacity="0.85" />
                      {/* Traffic light head */}
                      <rect x={x - 10} y="58" width="20" height="26" rx="4" fill="hsl(var(--card))" stroke={c.fill} strokeWidth="1.5" />
                      <circle cx={x} cy="71" r="6" fill={c.fill} opacity="0.95" />
                      {/* Progress arc */}
                      {j.phase === "green" && (
                        <circle cx={x} cy="71" r="9" fill="none" stroke="#16a34a" strokeWidth="2"
                          strokeDasharray={`${greenPct * 0.565} 100`} strokeLinecap="round"
                          style={{ transformOrigin: `${x}px 71px`, transform: "rotate(-90deg)" }}
                        />
                      )}
                      {/* Name */}
                      <text x={x} y="162" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="sans-serif">
                        {j.name.split(" ")[0]}
                      </text>
                      {/* Offset */}
                      <text x={x} y="50" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="8" fontFamily="monospace">
                        +{j.offset_s}s
                      </text>
                      {/* Phase */}
                      <text x={x} y="176" textAnchor="middle" fill={c.fill} fontSize="8" fontWeight="600" fontFamily="monospace">
                        {j.phase.toUpperCase()}
                      </text>
                    </g>
                  );
                })}

                {/* Animated vehicle */}
                <motion.g animate={{ x: 60 + vehicleProgress * 780 - 10 }} transition={{ type: "tween", duration: 0.18, ease: "linear" }}>
                  <rect x={0} y="112" width="20" height="13" rx="3" fill="#60a5fa" opacity="0.9" />
                  <rect x={3} y="107" width="14" height="8" rx="2" fill="#93c5fd" opacity="0.7" />
                  <circle cx={4} cy="126" r="3" fill="#1e40af" />
                  <circle cx={16} cy="126" r="3" fill="#1e40af" />
                </motion.g>

                {/* Wave propagation line */}
                <motion.line
                  x1={60 + vehicleProgress * 780} y1="55"
                  x2={60 + vehicleProgress * 780} y2="180"
                  stroke="#60a5fa" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3"
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                />

                {/* Legend */}
                {[
                  { color: "#16a34a", label: "Green" },
                  { color: "#ca8a04", label: "Yellow" },
                  { color: "#dc2626", label: "Red" },
                  { color: "#60a5fa", label: "Test vehicle" },
                ].map(({ color, label }, i) => (
                  <g key={label} transform={`translate(${60 + i * 110}, 205)`}>
                    <rect width="10" height="10" rx="2" fill={color} />
                    <text x="14" y="9" fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="sans-serif">{label}</text>
                  </g>
                ))}
              </svg>
            ) : (
              /* Fallback simple road animation */
              <div className="relative">
                <div className="relative h-24 bg-muted/30 rounded-xl border border-border/40 overflow-hidden mx-4">
                  <div className="absolute inset-0 flex items-center">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} className="flex-1 h-0.5 mx-2 bg-border/30 rounded" />
                    ))}
                  </div>
                  <div className="absolute top-1/2 left-0 right-0 flex items-center -translate-y-px">
                    {Array.from({ length: 40 }).map((_, i) => (
                      <div key={i} className={`h-px ${i % 2 === 0 ? "flex-1 bg-yellow-500/30" : "w-3"}`} />
                    ))}
                  </div>
                  {junctions.map((j, idx) => {
                    const xPct = (j.distance_m / totalDistance) * 100;
                    const isGreen = idx === 0 ? true : Math.abs(((vehicleTimeInCycle - j.offset_sec + cycle) % cycle)) < 8;
                    return (
                      <div key={j.id} className="absolute top-0 bottom-0 flex items-center" style={{ left: `${xPct}%` }}>
                        <div className={`w-1.5 h-full transition-colors duration-300 ${isGreen ? "bg-emerald-500/60" : "bg-red-600/60"}`} />
                      </div>
                    );
                  })}
                  <motion.div
                    className="absolute top-1/2 -translate-y-1/2 flex items-center"
                    style={{ left: `${vehicleProgress * 96}%` }}
                    animate={{ left: `${vehicleProgress * 96}%` }}
                    transition={{ duration: 0.18, ease: "linear" }}
                  >
                    <div className="bg-blue-500 rounded-sm w-7 h-4 flex items-center justify-center shadow-[0_0_8px_theme(colors.blue.500)]">
                      <Car className="w-3 h-3 text-white" />
                    </div>
                  </motion.div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Savings panel (live from backend) */}
        {savings && (
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs tracking-widest text-muted-foreground">GREEN WAVE IMPACT vs FIXED-SIGNAL BASELINE</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { icon: TrendingDown, label: "Stops reduced",        value: `${savings.stops_reduced_pct}%`,            color: "text-green-400",   bg: "bg-green-500/10 border-green-500/20" },
                  { icon: Timer,       label: "Idle time saved",       value: `${savings.idle_time_saved_s}s`,            color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20" },
                  { icon: Zap,         label: "Travel time faster",    value: `${savings.travel_time_improvement_pct}%`,  color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
                  { icon: Leaf,        label: "CO₂ saved / vehicle",   value: `${savings.co2_saved_kg_per_vehicle} kg`,   color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                  { icon: Leaf,        label: "CO₂ saved / day",       value: `${savings.co2_saved_kg_daily} kg`,         color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                  { icon: Waves,       label: "Trees equiv. / day",    value: `${savings.trees_equivalent_daily}`,        color: "text-green-300",   bg: "bg-green-500/10 border-green-500/20" },
                ].map(({ icon: Icon, label, value, color, bg }) => (
                  <div key={label} className={`border rounded-xl p-3.5 ${bg}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                    <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Junction offset table */}
        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs tracking-widest text-muted-foreground">PHASE OFFSET CALCULATIONS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-[10px] text-muted-foreground uppercase tracking-widest">
                    <th className="text-left py-2 pr-4">Junction</th>
                    <th className="text-right py-2 pr-4">Distance</th>
                    <th className="text-right py-2 pr-4">Travel Time</th>
                    <th className="text-right py-2 pr-4">Phase Offset</th>
                    <th className="text-left py-2">Live Phase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {(liveData?.junctions ?? junctions.map(j => ({ junction_id: j.id, name: j.name, position_m: j.distance_m, phase: "red" as const, offset_s: j.offset_sec, phase_elapsed_s: 0, green_duration_s: 45, cycle_length_s: cycle }))).map((j, idx) => {
                    const isLive = !!liveData;
                    const phase = isLive ? (j as JunctionLiveState).phase : "red";
                    const offset = isLive ? (j as JunctionLiveState).offset_s : junctions[idx]?.offset_sec ?? 0;
                    const dist = j.position_m;
                    const travel = Math.round((dist / speedMs) * 10) / 10;
                    const phaseColor = phase === "green" ? "text-green-400" : phase === "yellow" ? "text-yellow-400" : "text-red-400";
                    return (
                      <tr key={j.junction_id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${idx === 0 ? "bg-primary" : "bg-emerald-500"}`} />
                            <span className="font-medium">{j.name}</span>
                            {idx === 0 && <span className="text-[9px] text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded">ORIGIN</span>}
                          </div>
                        </td>
                        <td className="text-right py-3 pr-4 font-mono text-muted-foreground">
                          {dist === 0 ? "—" : `${dist}m`}
                        </td>
                        <td className="text-right py-3 pr-4 font-mono">
                          {dist === 0 ? "—" : `${travel}s`}
                        </td>
                        <td className="text-right py-3 pr-4">
                          <span className={`font-mono font-bold ${idx === 0 ? "text-muted-foreground" : "text-emerald-400"}`}>
                            {idx === 0 ? "0s" : `+${offset}s`}
                          </span>
                        </td>
                        <td className="py-3">
                          {isLive ? (
                            <span className={`text-xs font-semibold font-mono capitalize ${phaseColor}`}>{phase}</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              {idx === 0 ? "Reference — green at t=0" : `Green at +${offset}s`}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border/40">
              <p className="text-[10px] text-muted-foreground font-mono text-center leading-relaxed">
                offset = (distance ÷ speed_m/s) mod cycle_length
                <span className="mx-3 text-border">|</span>
                speed_m/s = {speed} km/h = {(speedMs).toFixed(2)} m/s
                <span className="mx-3 text-border">|</span>
                cycle = {cycle}s
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Cascade arrows */}
        <div className="flex items-center gap-3 overflow-x-auto pb-2">
          {junctions.map((j, idx) => (
            <div key={j.id} className="flex items-center gap-3 shrink-0">
              <div className="text-center">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3 min-w-[130px]">
                  <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-widest">{j.name}</p>
                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {idx === 0 ? "t=0s" : `t+${j.offset_sec}s`}
                  </p>
                  <p className="text-[9px] text-muted-foreground mt-1">{j.distance_m}m from start</p>
                </div>
              </div>
              {idx < junctions.length - 1 && (
                <div className="flex flex-col items-center gap-0.5">
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {(junctions[idx + 1].distance_m - j.distance_m)}m
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
