import { useState } from "react";
import { Shell } from "@/components/layout/shell";
import { API_URL as BASE } from "@/lib/api";
import { useTrafficStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlaskConical, Play, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  { id: "close_lane",      label: "Close a lane",           hasLane: true,  hasDuration: false },
  { id: "extend_green",    label: "Extend green phase",      hasLane: true,  hasDuration: true  },
  { id: "rush_hour_mode",  label: "Activate rush hour mode", hasLane: false, hasDuration: false },
  { id: "night_mode",      label: "Activate night mode",     hasLane: false, hasDuration: false },
  { id: "emergency_clear", label: "Emergency lane clear",    hasLane: true,  hasDuration: false },
];

const RISK_STYLES = {
  low:      "bg-green-500/10 text-green-400  border-green-500/40",
  medium:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/40",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/40",
  critical: "bg-red-500/10 text-red-400     border-red-500/40",
} as const;

const RISK_ICONS: Record<string, string> = { low: "✓", medium: "⚠", high: "✕", critical: "✕" };

interface ScenarioResult {
  scenario_id: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  confidence_pct: number;
  baseline: { avg_density: number; total_vehicles: number; queue_lengths: Record<string, number> };
  predicted: { avg_density: number; total_vehicles: number; queue_lengths: Record<string, number> };
  delta: Record<string, number | string>;
  recommendations: string[];
}

export default function Scenarios() {
  const { lanes } = useTrafficStore();
  const [scenarioType, setScenarioType] = useState("close_lane");
  const [lane, setLane] = useState("north");
  const [extendS, setExtendS] = useState(30);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);

  const selected = SCENARIOS.find(s => s.id === scenarioType);

  const runSimulation = async () => {
    setLoading(true);
    const params: Record<string, unknown> = {};
    if (selected?.hasLane) params["lane"] = lane;
    if (selected?.hasDuration) params["extend_s"] = extendS;

    const currentLanes = Object.values(lanes).map(l => ({
      direction: ["north", "south", "east", "west"][l.lane_id],
      density: l.density,
      vehicle_count: l.vehicle_count,
      avg_speed: l.avg_speed,
    }));

    try {
      const res = await fetch(`${BASE}/scenarios/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_type: scenarioType, params, current_lanes: currentLanes }),
      });
      if (res.ok) setResult(await res.json() as ScenarioResult);
    } catch { /* no-op */ }
    finally { setLoading(false); }
  };

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FlaskConical className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">What-If Simulator</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Simulate any change before applying it. See predicted queue lengths, overflow risk, and recommendations.
            </p>
          </div>
        </div>

        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs tracking-widest text-muted-foreground">CHOOSE A SCENARIO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {SCENARIOS.map(s => (
                <button key={s.id} onClick={() => { setScenarioType(s.id); setResult(null); }}
                  className={cn(
                    "text-sm px-3 py-2.5 rounded-xl border text-left transition-all",
                    scenarioType === s.id
                      ? "bg-primary/10 border-primary/50 text-primary"
                      : "bg-muted/40 border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                  )}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex gap-4 flex-wrap items-end">
              {selected?.hasLane && (
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">Lane</label>
                  <select
                    value={lane} onChange={e => setLane(e.target.value)}
                    className="bg-muted/60 border border-border/60 text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/60">
                    {["north", "south", "east", "west"].map(d => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </div>
              )}
              {selected?.hasDuration && (
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest block mb-1.5">
                    Extend by: {extendS}s
                  </label>
                  <input type="range" min="10" max="120" step="5" value={extendS}
                    onChange={e => setExtendS(Number(e.target.value))}
                    className="w-40 accent-primary" />
                </div>
              )}
              <button onClick={runSimulation} disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {loading ? "Simulating..." : "Run Simulation"}
              </button>
            </div>
          </CardContent>
        </Card>

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className={cn("border rounded-2xl p-4", RISK_STYLES[result.risk_level])}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{result.description}</p>
                    <p className="text-xs mt-0.5 opacity-75">
                      Risk: {result.risk_level.toUpperCase()} · Confidence: {result.confidence_pct}%
                    </p>
                  </div>
                  <span className="text-2xl">{RISK_ICONS[result.risk_level]}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Current state (baseline)", data: result.baseline, accent: "border-border/60" },
                  { label: "Predicted after change",   data: result.predicted, accent: "border-primary/50" },
                ].map(panel => (
                  <Card key={panel.label} className={cn("bg-card/40 backdrop-blur border", panel.accent)}>
                    <CardContent className="p-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">{panel.label}</p>
                      <p className="text-3xl font-bold font-mono">{panel.data.avg_density?.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground mb-3">avg density</p>
                      <p className="text-xl font-semibold font-mono">{panel.data.total_vehicles}</p>
                      <p className="text-xs text-muted-foreground mb-3">total vehicles</p>
                      {panel.data.queue_lengths && (
                        <div className="space-y-1 pt-2 border-t border-border/30">
                          {Object.entries(panel.data.queue_lengths).map(([dir, q]) => (
                            <div key={dir} className="flex justify-between text-xs">
                              <span className="text-muted-foreground capitalize">{dir}</span>
                              <span className="font-mono">{q} queued</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="bg-card/40 backdrop-blur border-border/50">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">AI Recommendations</p>
                  <ul className="space-y-2">
                    {result.recommendations.map((rec, i) => (
                      <li key={i} className="flex gap-2 text-sm text-foreground/80">
                        <span className="text-primary flex-shrink-0 mt-0.5">→</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Shell>
  );
}
