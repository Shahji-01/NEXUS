import { motion } from "framer-motion";
import { useTrafficStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu } from "lucide-react";

const LANE_NAMES: Record<number, string> = {
  0: "N Bound",
  1: "S Bound",
  2: "E Bound",
  3: "W Bound",
};

const LANE_LABELS: Record<number, string> = {
  0: "N",
  1: "S",
  2: "E",
  3: "W",
};

function scoreColor(score: number): string {
  if (score >= 80) return "bg-red-500";
  if (score >= 55) return "bg-orange-500";
  if (score >= 30) return "bg-yellow-500";
  return "bg-emerald-500";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 30) return "MED";
  return "LOW";
}

export function AiPriorityQueue() {
  const { pressureScores, adaptiveCycleBudgetSec, signals } = useTrafficStore();

  const sorted = Object.entries(pressureScores)
    .map(([id, score]) => ({ id: Number(id), score }))
    .sort((a, b) => b.score - a.score);

  return (
    <Card className="bg-card/40 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            AI PRIORITY QUEUE
          </CardTitle>
          <span className="text-[10px] text-muted-foreground font-mono">
            CYCLE {adaptiveCycleBudgetSec}s
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pb-4">
        {sorted.map(({ id, score }, rank) => {
          const isGreen = signals?.current_green === id;
          return (
            <div key={id} className="flex items-center gap-2">
              {/* Rank badge */}
              <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                rank === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {rank + 1}
              </span>

              {/* Lane name */}
              <div className="w-14 text-xs font-medium text-foreground flex items-center gap-1">
                {isGreen && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                <span className={isGreen ? "text-emerald-400" : ""}>{LANE_NAMES[id]}</span>
              </div>

              {/* Pressure bar */}
              <div className="flex-1 h-4 bg-muted/40 rounded-full overflow-hidden relative">
                <motion.div
                  className={`h-full rounded-full ${scoreColor(score)}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${score}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                {/* Score label inside bar */}
                <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-white/80 leading-none select-none">
                  {LANE_LABELS[id]} — {scoreLabel(score)}
                </span>
              </div>

              {/* Numeric score */}
              <span className="w-8 text-right text-[11px] font-mono text-muted-foreground">
                {score}
              </span>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">Waiting for data…</p>
        )}

        <p className="text-[10px] text-muted-foreground pt-1">
          Score = density × wait factor · highest score wins next green · starvation-safe
        </p>
      </CardContent>
    </Card>
  );
}
