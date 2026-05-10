import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, Clock, Gauge, Zap, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

import { API_URL as BASE } from "@/lib/api";

interface Incident {
  id: string;
  lane_id: number;
  lane_name: string;
  detected_at: string;
  resolved_at: string | null;
  status: "active" | "resolved";
  severity: "warning" | "critical";
  type: "speed_anomaly" | "density_spike" | "sudden_stop" | "flow_breakdown";
  description: string;
  speed_at_detection: number;
  density_at_detection: number;
  confidence: number;
}

interface IncidentsResponse {
  active: Incident[];
  resolved: Incident[];
  total_active: number;
  generated_at: string;
}

const TYPE_LABELS: Record<Incident["type"], string> = {
  speed_anomaly: "Speed Anomaly",
  density_spike: "Density Spike",
  sudden_stop: "Sudden Stop",
  flow_breakdown: "Flow Breakdown",
};

const TYPE_ICONS: Record<Incident["type"], React.ElementType> = {
  speed_anomaly: Gauge,
  density_spike: Activity,
  sudden_stop: AlertTriangle,
  flow_breakdown: Zap,
};

const LANE_COLORS = ["#3b82f6", "#22d3ee", "#a78bfa", "#f97316"];

function IncidentCard({ incident }: { incident: Incident }) {
  const Icon = TYPE_ICONS[incident.type] ?? AlertTriangle;
  const isCritical = incident.severity === "critical";
  const isActive = incident.status === "active";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25 }}
    >
      <Card className={cn(
        "border transition-colors",
        isActive && isCritical && "border-red-500/50 bg-red-500/5",
        isActive && !isCritical && "border-yellow-500/40 bg-yellow-500/5",
        !isActive && "border-border/30 bg-card/20 opacity-70",
      )}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border",
              isCritical ? "bg-red-500/10 border-red-500/30" : "bg-yellow-500/10 border-yellow-500/30",
              isActive && isCritical && "animate-pulse",
            )}>
              <Icon className={cn("w-4 h-4", isCritical ? "text-red-400" : "text-yellow-400")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{incident.id}</span>
                <Badge variant="outline" className={cn(
                  "text-[10px] px-1.5 py-0",
                  isCritical ? "border-red-500/50 text-red-400" : "border-yellow-500/50 text-yellow-400",
                )}>
                  {incident.severity.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground">
                  {TYPE_LABELS[incident.type]}
                </Badge>
                {!isActive && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/40 text-green-400">
                    RESOLVED
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{incident.description}</p>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground/70 font-mono">
                <span style={{ color: LANE_COLORS[incident.lane_id] ?? "#fff" }}>
                  {incident.lane_name}
                </span>
                <span>Speed: {incident.speed_at_detection} km/h</span>
                <span>Density: {incident.density_at_detection}%</span>
                <span>Confidence: {Math.round(incident.confidence * 100)}%</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>{formatDistanceToNow(new Date(incident.detected_at), { addSuffix: true })}</span>
              </div>
              {incident.resolved_at && (
                <div className="text-[10px] text-green-400 mt-0.5 flex items-center gap-1 justify-end">
                  <ShieldCheck className="w-3 h-3" />
                  Cleared {formatDistanceToNow(new Date(incident.resolved_at), { addSuffix: true })}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function IncidentsPage() {
  const [data, setData] = useState<IncidentsResponse | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch(`${BASE}/incidents`)
        .then(r => r.json())
        .then(setData)
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  const active = data?.active ?? [];
  const resolved = data?.resolved ?? [];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Predictive Incident Detection</h2>
            <p className="text-xs text-muted-foreground">AI monitors speed &amp; density patterns to detect incidents before reports arrive</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {active.length > 0 ? (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/40 animate-pulse">
                {active.length} ACTIVE
              </Badge>
            ) : (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/40">
                ALL CLEAR
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active Incidents", value: String(active.length), color: active.length > 0 ? "text-red-400" : "text-green-400" },
            { label: "Resolved Today", value: String(resolved.length), color: "text-muted-foreground" },
            { label: "Detection Method", value: "Speed + Density AI", color: "text-primary" },
          ].map(({ label, value, color }) => (
            <Card key={label} className="bg-card/40 border-border/50">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-bold mt-1 tabular-nums", color)}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
            Active Incidents
          </h3>
          {active.length === 0 ? (
            <Card className="bg-card/20 border-border/30">
              <CardContent className="p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-green-400" />
                No active incidents detected — all lanes nominal
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence mode="popLayout">
              {active.map(inc => <IncidentCard key={inc.id} incident={inc} />)}
            </AnimatePresence>
          )}
        </div>

        {resolved.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
              Recently Resolved
            </h3>
            <div className="space-y-2">
              {resolved.slice(0, 10).map(inc => <IncidentCard key={inc.id} incident={inc} />)}
            </div>
          </div>
        )}

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Detection Logic</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                { type: "Sudden Stop", trigger: "Speed drop >45% + density >60%", severity: "Critical" },
                { type: "Speed Anomaly", trigger: "Speed drop >28% + density >40%", severity: "Warning" },
                { type: "Flow Breakdown", trigger: "Density surge >50% + density >70%", severity: "Critical" },
                { type: "Density Spike", trigger: "Density surge >32% + density >52%", severity: "Warning" },
              ].map(({ type, trigger, severity }) => (
                <div key={type} className="bg-muted/20 rounded-lg p-3 space-y-1">
                  <p className="font-semibold">{type}</p>
                  <p className="text-muted-foreground text-[10px]">{trigger}</p>
                  <Badge variant="outline" className={cn(
                    "text-[9px] px-1 py-0",
                    severity === "Critical" ? "border-red-500/40 text-red-400" : "border-yellow-500/40 text-yellow-400",
                  )}>
                    {severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
