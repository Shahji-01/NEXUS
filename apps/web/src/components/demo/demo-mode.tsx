import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, CheckCircle2, Circle, Loader2, Zap, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrafficStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type StepStatus = "pending" | "active" | "done";

interface DemoStep {
  id: string;
  emoji: string;
  label: string;
  detail: string;
  duration: number;
  action?: () => Promise<void>;
}

const STEPS: DemoStep[] = [
  {
    id: "rush_hour",
    emoji: "📈",
    label: "Activating Rush Hour Mode",
    detail: "AI switching all lanes to optimized rush-hour cycle timing — green windows dynamically extended.",
    duration: 10000,
    action: async () => {
      await fetch("/api/copilot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Switch to rush hour mode", traffic_context: {} }),
      }).catch(() => null);
    },
  },
  {
    id: "congestion",
    emoji: "🚗",
    label: "High Density Detected",
    detail: "North and East Bound lanes approaching capacity — pressure scores elevated.",
    duration: 11000,
  },
  {
    id: "critical",
    emoji: "⚠️",
    label: "Critical Threshold Exceeded",
    detail: "East Bound at 89% density — AI is pre-emptively redistributing signal budget.",
    duration: 9000,
  },
  {
    id: "emergency",
    emoji: "🚨",
    label: "Emergency Vehicle Inbound",
    detail: "Ambulance detected on North Bound — immediate green corridor granted, all other lanes halted.",
    duration: 18000,
    action: async () => {
      await fetch("/api/emergency/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane_id: 0, vehicle_type: "ambulance" }),
      }).catch(() => null);
    },
  },
  {
    id: "ai_query",
    emoji: "🤖",
    label: "AI Copilot Queried",
    detail: "Asking Claude to assess live junction state and recommend next actions.",
    duration: 14000,
    action: async () => {
      await fetch("/api/copilot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What's causing the North Bound backup and what should we do?", traffic_context: {} }),
      }).catch(() => null);
    },
  },
  {
    id: "normalize",
    emoji: "✅",
    label: "Junction Normalized",
    detail: "Emergency cleared — AI restoring optimal signal defaults, throughput recovering.",
    duration: 7000,
    action: async () => {
      await fetch("/api/copilot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Reset junction to defaults", traffic_context: {} }),
      }).catch(() => null);
    },
  },
];

const TOTAL_DURATION = STEPS.reduce((s, st) => s + st.duration, 0);

export function DemoMode() {
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const cancelRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setCopilotOpen } = useTrafficStore();

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const resetAll = useCallback(() => {
    cancelRef.current = true;
    clearTimer();
    setRunning(false);
    setCurrentStep(-1);
    setStatuses({});
    setElapsed(0);
    setDone(false);
    setCopilotOpen(false);
  }, [setCopilotOpen]);

  const runStep = useCallback((idx: number) => {
    if (cancelRef.current || idx >= STEPS.length) {
      if (!cancelRef.current) { setDone(true); clearTimer(); }
      return;
    }
    const step = STEPS[idx]!;
    setCurrentStep(idx);
    setStatuses(prev => ({ ...prev, [step.id]: "active" }));

    const doAction = async () => {
      try { if (step.action) await step.action(); } catch { /* silent */ }
      if (cancelRef.current) return;
      setStatuses(prev => ({ ...prev, [step.id]: "done" }));
      setTimeout(() => { if (!cancelRef.current) runStep(idx + 1); }, step.duration);
    };

    doAction();
  }, []);

  const startDemo = useCallback(() => {
    cancelRef.current = false;
    setRunning(true);
    setDone(false);
    setCurrentStep(-1);
    setStatuses({});
    setElapsed(0);

    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    runStep(0);
  }, [runStep]);

  useEffect(() => () => { cancelRef.current = true; clearTimer(); }, []);

  // Progress: completed step durations / total
  let doneMs = 0;
  for (let i = 0; i < currentStep; i++) doneMs += STEPS[i]!.duration;
  const pct = TOTAL_DURATION > 0 ? Math.min(100, Math.round((doneMs / TOTAL_DURATION) * 100)) : 0;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <AnimatePresence mode="wait">
      {/* Idle trigger row */}
      {!running && !done && (
        <motion.div
          key="trigger"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-primary/20 bg-primary/5 backdrop-blur"
        >
          <div className="flex items-center gap-2.5">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Demo Mode</span> — watch the full AI junction system in action, step by step
            </span>
          </div>
          <Button
            size="sm"
            onClick={startDemo}
            className="h-8 px-4 text-xs gap-1.5"
          >
            <Play className="w-3 h-3" />
            Start Walkthrough
          </Button>
        </motion.div>
      )}

      {/* Running / done panel */}
      {(running || done) && (
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22 }}
          className="rounded-xl border border-primary/30 bg-card/70 backdrop-blur shadow-lg overflow-hidden"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                done ? "bg-green-400" : "bg-primary animate-pulse"
              )} />
              <span className="text-xs font-bold tracking-widest uppercase">
                {done ? "Demo Complete" : "Live Demo Walkthrough"}
              </span>
              {!done && (
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                  {mm}:{ss}
                </span>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={resetAll}
              title={done ? "Close" : "Cancel demo"}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Steps */}
          <div className="px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {STEPS.map((step, idx) => {
              const status = statuses[step.id] ?? "pending";
              const isActive = status === "active";
              const isDone = status === "done";
              const isPending = status === "pending";

              return (
                <div
                  key={step.id}
                  className={cn(
                    "rounded-lg px-3 py-2.5 border transition-all duration-300 flex flex-col gap-1.5",
                    isActive && "border-primary/50 bg-primary/8 shadow-sm",
                    isDone && "border-green-500/20 bg-green-500/5",
                    isPending && "border-border/30 bg-muted/10"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg leading-none">{step.emoji}</span>
                    <div className="flex-shrink-0">
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      {isActive && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
                      {isPending && <Circle className="w-3.5 h-3.5 text-muted-foreground/25" />}
                    </div>
                  </div>
                  <p className={cn(
                    "text-[10px] font-semibold leading-tight",
                    isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/40"
                  )}>
                    {step.label}
                  </p>
                  {isActive && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-[9px] text-muted-foreground leading-relaxed"
                    >
                      {step.detail}
                    </motion.p>
                  )}
                  {isActive && (
                    <div className="flex items-center gap-1 text-[9px] text-primary font-mono font-bold">
                      <ChevronRight className="w-2.5 h-2.5" />
                      LIVE
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar or done banner */}
          {!done ? (
            <div className="mx-4 mb-3 mt-1">
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1 font-mono">
                Step {Math.max(1, currentStep + 1)} of {STEPS.length} · Watch the signal grid and notification bell respond live
              </p>
            </div>
          ) : (
            <div className="mx-4 mb-3 mt-1 flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <Zap className="w-3.5 h-3.5 flex-shrink-0" />
              <span>All 6 systems demonstrated — AI mode active, signal grid optimized, emergency resolved.</span>
              <Button size="sm" variant="ghost" onClick={resetAll} className="ml-auto h-6 px-2 text-[10px] text-green-400 hover:text-green-300">
                Close
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
