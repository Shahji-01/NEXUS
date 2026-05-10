import { Shell } from "@/components/layout/shell";
import { useTrafficStore } from "@/lib/store";
import { useGetEmergencyEvents, getGetEmergencyEventsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Activity, Shield, Zap, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetEmergencyEventsQueryKey as emgKey } from "@workspace/api-client-react";

const LANE_NAMES = ["North Bound", "South Bound", "East Bound", "West Bound"];
const EMERG_ICONS: Record<string, string> = { ambulance: "🚑", fire_truck: "🚒", police: "🚓" };

function getIcon(type: string) {
  return EMERG_ICONS[type?.toLowerCase().replace(/\s+/g, "_")] ?? "🚨";
}

function useElapsedTimer(startTimestamp: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTimestamp) { setElapsed(0); return; }
    const update = () => {
      setElapsed(Math.floor((Date.now() - new Date(startTimestamp).getTime()) / 1000));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startTimestamp]);
  return elapsed;
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

type FilterTab = "all" | "active" | "resolved";
type VehicleType = "ambulance" | "fire_truck" | "police";
const VEHICLE_OPTIONS: { type: VehicleType; icon: string; label: string }[] = [
  { type: "ambulance",  icon: "🚑", label: "Ambulance"  },
  { type: "fire_truck", icon: "🚒", label: "Fire Truck" },
  { type: "police",     icon: "🚓", label: "Police"     },
];
const LANE_OPTIONS = [
  { id: 0, label: "North" },
  { id: 1, label: "South" },
  { id: 2, label: "East"  },
  { id: 3, label: "West"  },
];

export default function Emergency() {
  const { activeEmergency } = useTrafficStore();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [triggerLane, setTriggerLane] = useState(0);
  const [triggerType, setTriggerType] = useState<VehicleType>("ambulance");
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const queryClient = useQueryClient();
  const elapsed = useElapsedTimer(activeEmergency ? activeEmergency.timestamp : null);

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const res = await fetch(`${BASE}/emergency/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane_id: triggerLane, vehicle_type: triggerType }),
      });
      const data = await res.json() as { success: boolean; message?: string };
      setTriggerMsg({ ok: data.success, text: data.message ?? (data.success ? "Emergency triggered!" : "Failed") });
      if (data.success) {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: emgKey({ limit: 50 }) }), 800);
      }
    } catch {
      setTriggerMsg({ ok: false, text: "Network error — could not trigger emergency." });
    } finally {
      setTriggering(false);
      setTimeout(() => setTriggerMsg(null), 4000);
    }
  }, [triggerLane, triggerType, queryClient]);

  const { data, isLoading } = useGetEmergencyEvents(
    { limit: 50 },
    { query: { queryKey: getGetEmergencyEventsQueryKey({ limit: 50 }), refetchInterval: 5000 } }
  );

  const events = data?.events ?? [];
  const totalEvents = events.length;
  const activeEvents = events.filter(e => !e.resolved).length;
  const resolvedEvents = events.filter(e => e.resolved).length;
  const avgConf = events.length > 0
    ? Math.round(events.reduce((s, e) => s + e.confidence, 0) / events.length * 100)
    : 0;

  const filtered = events.filter(e => {
    if (filter === "active") return !e.resolved;
    if (filter === "resolved") return e.resolved;
    return true;
  });

  return (
    <Shell>
      <div className="space-y-6">

        {/* Active Emergency Banner */}
        <AnimatePresence>
          {activeEmergency && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="relative overflow-hidden bg-red-950 border border-red-500/50 rounded-xl shadow-[0_0_40px_rgba(239,68,68,0.2)] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                {/* Animated background glow */}
                <div className="absolute inset-0 bg-gradient-to-r from-red-900/30 to-transparent pointer-events-none" />
                <div className="absolute right-0 top-0 bottom-0 w-64 bg-gradient-to-l from-red-800/10 to-transparent pointer-events-none" />

                <div className="flex items-center gap-4 z-10">
                  <div className="w-14 h-14 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-3xl shrink-0">
                    <motion.span
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      {getIcon(activeEmergency.vehicle_type)}
                    </motion.span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                      <span className="text-[10px] font-bold tracking-widest text-red-400 uppercase">Active Emergency</span>
                    </div>
                    <h2 className="font-bold text-white text-lg tracking-wide uppercase">
                      {activeEmergency.vehicle_type?.replace("_", " ")} Detected
                    </h2>
                    <p className="text-sm text-red-300 font-mono mt-0.5">
                      {LANE_NAMES[activeEmergency.lane_id]} · {Math.round(activeEmergency.confidence * 100)}% confidence · Green corridor active
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-6 z-10 shrink-0">
                  <div className="text-center">
                    <div className="text-[9px] uppercase tracking-widest text-red-400/70 mb-1">Elapsed</div>
                    <div className="font-mono text-2xl font-bold text-white tabular-nums">
                      {formatElapsed(elapsed)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] uppercase tracking-widest text-red-400/70 mb-1">Confidence</div>
                    <div className="font-mono text-2xl font-bold text-red-300">
                      {Math.round(activeEmergency.confidence * 100)}%
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Demo Trigger Panel */}
        <Card className="bg-card/40 backdrop-blur border-orange-500/30 border">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold tracking-widest text-orange-400 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" />
              DEMO CONTROLS — SIMULATE EMERGENCY
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
              <div className="flex-1 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Lane</p>
                <div className="flex gap-1.5 flex-wrap">
                  {LANE_OPTIONS.map(l => (
                    <Button
                      key={l.id}
                      size="sm"
                      variant={triggerLane === l.id ? "default" : "outline"}
                      className="h-8 px-3 text-xs"
                      onClick={() => setTriggerLane(l.id)}
                    >
                      {l.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Vehicle Type</p>
                <div className="flex gap-1.5 flex-wrap">
                  {VEHICLE_OPTIONS.map(v => (
                    <Button
                      key={v.type}
                      size="sm"
                      variant={triggerType === v.type ? "default" : "outline"}
                      className="h-8 px-3 text-xs gap-1"
                      onClick={() => setTriggerType(v.type)}
                    >
                      <span>{v.icon}</span> {v.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Button
                  onClick={handleTrigger}
                  disabled={triggering || !!activeEmergency}
                  variant="destructive"
                  className="h-9 px-5 gap-2 font-semibold"
                >
                  {triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {activeEmergency ? "Emergency Active" : "Trigger Emergency"}
                </Button>
                <AnimatePresence>
                  {triggerMsg && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`text-[11px] font-mono ${triggerMsg.ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {triggerMsg.ok ? "✓" : "✗"} {triggerMsg.text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Events", value: totalEvents, icon: Activity, color: "blue" },
            { label: "Active", value: activeEvents, icon: AlertTriangle, color: activeEvents > 0 ? "red" : "green" },
            { label: "Resolved", value: resolvedEvents, icon: CheckCircle2, color: "green" },
            { label: "Avg Confidence", value: `${avgConf}%`, icon: Shield, color: "purple" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/40 backdrop-blur border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${color}-500/10 border border-${color}-500/30 shrink-0`}>
                  <Icon className={`w-4 h-4 text-${color}-400`} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-xl font-mono leading-tight">{isLoading ? "—" : value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Event log with filter tabs */}
        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                EMERGENCY EVENT LOG
              </CardTitle>
              <div className="flex gap-1.5">
                {(["all", "active", "resolved"] as FilterTab[]).map(tab => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={filter === tab ? "default" : "outline"}
                    className="text-[10px] h-7 px-3 uppercase tracking-wider"
                    onClick={() => setFilter(tab)}
                  >
                    {tab}
                    {tab === "active" && activeEvents > 0 && (
                      <span className="ml-1.5 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                        {activeEvents}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/50">
                    <TableHead className="w-12 text-[10px] uppercase tracking-wider">Type</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Time</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Lane</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Vehicle</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Confidence</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Duration</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground text-sm">
                        Loading events...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground text-sm">
                        No {filter !== "all" ? filter : ""} events recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((event) => (
                      <TableRow key={event.id} className="border-border/30 hover:bg-muted/20">
                        <TableCell className="text-2xl py-3">{getIcon(event.vehicle_type)}</TableCell>
                        <TableCell className="py-3">
                          <div className="font-mono text-xs">{format(new Date(event.timestamp), "MMM dd, HH:mm:ss")}</div>
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                            {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs tracking-wider uppercase py-3">
                          {LANE_NAMES[event.lane_id]}
                        </TableCell>
                        <TableCell className="uppercase text-xs tracking-wider text-muted-foreground py-3">
                          {event.vehicle_type?.replace("_", " ")}
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${Math.round(event.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs">{Math.round(event.confidence * 100)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs py-3">
                          {event.duration_seconds ? `${event.duration_seconds}s` : (
                            !event.resolved ? (
                              <span className="text-red-400 animate-pulse">Active</span>
                            ) : "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right py-3">
                          {event.resolved ? (
                            <Badge variant="outline" className="text-green-500 border-green-500/30 gap-1 text-[10px]">
                              <CheckCircle2 className="w-3 h-3" /> Resolved
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1 text-[10px] animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" /> Active
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
