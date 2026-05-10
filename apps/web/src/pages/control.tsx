import { Shell } from "@/components/layout/shell";
import { useTrafficStore } from "@/lib/store";
import { TrafficLight } from "@/components/traffic/traffic-light";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useOverrideSignal, useSetAiMode, useLogin } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Shield, BrainCircuit, Hand, Lock, Zap, Activity, Clock, Database, PersonStanding } from "lucide-react";
import { Input } from "@/components/ui/input";

const LANE_NAMES = ["North Bound", "South Bound", "East Bound", "West Bound"];
const BASE = "/api";

interface HealthStats { uptime_seconds: number; db_rows: number; active_spike: { lane_id: number; density: number; expires_in: number } | null }

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function Control() {
  const { signals } = useTrafficStore();
  const [selectedLane, setSelectedLane] = useState<string>("0");
  const [duration, setDuration] = useState<number[]>([30]);
  const [isEmergency, setIsEmergency] = useState(false);
  const [reason, setReason] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [walkQueued, setWalkQueued] = useState(false);
  const [spikeLane, setSpikeLane] = useState<string>("0");
  const [spikeLevel, setSpikeLevel] = useState<"high" | "critical">("high");
  const [spiking, setSpiking] = useState(false);
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const overrideMutation = useOverrideSignal();
  const aiModeMutation = useSetAiMode();
  const loginMutation = useLogin();

  // Poll health stats every 5s
  useEffect(() => {
    const fetch_ = () => {
      fetch(`${BASE}/health/stats`)
        .then(r => r.json())
        .then(d => { setStats(d); setStatsLoading(false); })
        .catch(() => setStatsLoading(false));
    };
    fetch_();
    const id = setInterval(fetch_, 5000);
    return () => clearInterval(id);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { username, password } }, {
      onSuccess: () => { setIsAuthenticated(true); toast.success("Authentication successful. Controls unlocked."); },
      onError: () => { toast.error("Invalid credentials. Try admin / admin123"); },
    });
  };

  const handleOverride = () => {
    overrideMutation.mutate({
      data: { lane_id: parseInt(selectedLane), duration_seconds: duration[0], emergency: isEmergency, reason: reason || undefined }
    }, {
      onSuccess: () => {
        toast.success(`Override active for ${LANE_NAMES[parseInt(selectedLane)]}`, {
          description: `Duration: ${duration[0]}s${isEmergency ? " (EMERGENCY)" : ""}`
        });
        setReason("");
      },
      onError: () => { toast.error("Override failed. Unauthorized."); },
    });
  };

  const handleAiModeToggle = (checked: boolean) => {
    aiModeMutation.mutate({ data: { enabled: checked } }, {
      onSuccess: () => { toast.success(`AI Mode ${checked ? "Enabled" : "Disabled"}`); },
      onError: () => { toast.error("Failed to change mode. Unauthorized."); },
    });
  };

  const handlePedestrianRequest = async () => {
    setWalkQueued(true);
    try {
      await fetch(`${BASE}/signals/pedestrian-request`, { method: "POST" });
      toast.success("Pedestrian walk phase queued", {
        description: "Will activate after the current green cycle ends.",
        icon: "🚶",
        duration: 6000,
      });
      setTimeout(() => setWalkQueued(false), 15000);
    } catch {
      toast.error("Failed to queue walk phase.");
      setWalkQueued(false);
    }
  };

  const handleSpike = async () => {
    setSpiking(true);
    try {
      const res = await fetch(`${BASE}/traffic/spike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane_id: parseInt(spikeLane), level: spikeLevel }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.warning(`Congestion spike triggered on ${LANE_NAMES[parseInt(spikeLane)]}`, {
          description: `${spikeLevel.toUpperCase()} — target density ${data.target_density}% for ~${data.expires_in_seconds}s`,
          icon: spikeLevel === "critical" ? "🔴" : "🟠",
          duration: 8000,
        });
      }
    } catch {
      toast.error("Failed to trigger spike.");
    } finally {
      setSpiking(false);
    }
  };

  return (
    <Shell>
      <div className="space-y-6 max-w-6xl mx-auto">

        {/* Auth gate */}
        {!isAuthenticated && (
          <Card className="bg-destructive/10 border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2 text-base">
                <Lock className="w-4 h-4" /> SYSTEM LOCKED
              </CardTitle>
              <CardDescription className="text-destructive/80">
                Authentication required for manual control. Demo: <span className="font-mono text-xs text-destructive">admin / admin123</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-destructive text-xs">Username</Label>
                  <Input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="border-destructive/30 bg-destructive/5 w-40" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-destructive text-xs">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="border-destructive/30 bg-destructive/5 w-40" />
                </div>
                <Button type="submit" variant="destructive" size="sm" disabled={loginMutation.isPending} className="font-mono tracking-wider">
                  {loginMutation.isPending ? "Authenticating..." : "AUTHORIZE"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* AI Mode toggle */}
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-primary/10 border border-primary/20 p-4 rounded-lg transition-opacity ${!isAuthenticated && "opacity-50 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            {signals?.ai_mode ? (
              <BrainCircuit className="w-8 h-8 text-primary animate-pulse" />
            ) : (
              <Hand className="w-8 h-8 text-muted-foreground" />
            )}
            <div>
              <h2 className="font-bold text-base flex items-center gap-2">
                SYSTEM MODE:{" "}
                <span className={signals?.ai_mode ? "text-primary" : "text-muted-foreground"}>
                  {signals?.ai_mode ? "AUTO (AI OPTIMIZED)" : "MANUAL"}
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                {signals?.ai_mode
                  ? "AI is currently managing signal timings based on real-time density."
                  : "System is under manual operator control."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="ai-mode" className="font-mono uppercase text-xs tracking-widest">Toggle AI Mode</Label>
            <Switch id="ai-mode" checked={signals?.ai_mode ?? true} onCheckedChange={handleAiModeToggle} disabled={aiModeMutation.isPending || !isAuthenticated} />
          </div>
        </div>

        {/* Main controls row */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 transition-opacity ${!isAuthenticated && "opacity-50 pointer-events-none"}`}>

          {/* Manual Override */}
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">MANUAL OVERRIDE</CardTitle>
              <CardDescription className="text-xs">Force a specific lane to green.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs">Target Lane</Label>
                <Select value={selectedLane} onValueChange={setSelectedLane} disabled={!isAuthenticated}>
                  <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANE_NAMES.map((name, i) => (
                      <SelectItem key={i} value={i.toString()} className="font-mono text-sm">{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Duration</Label>
                  <span className="font-mono text-sm">{duration[0]}s</span>
                </div>
                <Slider value={duration} onValueChange={setDuration} max={120} min={10} step={5} disabled={!isAuthenticated} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Reason (Optional)</Label>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Clearing congestion" disabled={!isAuthenticated} className="text-sm" />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg bg-destructive/5 border-destructive/20">
                <div>
                  <Label className="text-destructive text-xs">Emergency Priority</Label>
                  <p className="text-[10px] text-muted-foreground">Preempt safety delays.</p>
                </div>
                <Switch checked={isEmergency} onCheckedChange={setIsEmergency} disabled={!isAuthenticated} />
              </div>
              <Button className="w-full font-bold tracking-wider text-sm" size="lg" variant={isEmergency ? "destructive" : "default"} onClick={handleOverride} disabled={overrideMutation.isPending || !isAuthenticated}>
                {overrideMutation.isPending ? "EXECUTING..." : "EXECUTE OVERRIDE"}
              </Button>
            </CardContent>
          </Card>

          {/* Live Signals */}
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" /> LIVE SIGNALS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-8 gap-y-10 justify-items-center p-6 bg-black/20 rounded-xl border border-white/5">
                {[0, 1, 2, 3].map((id) => (
                  <div key={id} className="flex flex-col items-center gap-2">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-widest bg-background/80 px-2 py-1 rounded border">{LANE_NAMES[id]}</span>
                    <TrafficLight
                      phase={signals?.phases?.[id] ?? "red"}
                      timeRemaining={signals?.current_green === id ? signals?.time_remaining : undefined}
                      emergency={!!(signals?.emergency_active && signals?.emergency_lane === id)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Demo Tools row (only when authenticated) */}
        {isAuthenticated && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Pedestrian Walk Phase */}
            <Card className="bg-cyan-950/20 border-cyan-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold tracking-widest text-cyan-400 flex items-center gap-2">
                  <PersonStanding className="w-3.5 h-3.5" /> PEDESTRIAN CROSSING
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Queue a 12-second walk phase — all lanes red, pedestrians clear.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
                  <PersonStanding className="w-8 h-8 text-cyan-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Activates after the current green cycle ends (YELLOW → ALL RED → <span className="text-cyan-400 font-mono">WALK 12s</span>).</p>
                    <p>The AI resumes normal pressure-based scheduling immediately after.</p>
                  </div>
                </div>
                {walkQueued && (
                  <div className="text-[10px] text-cyan-400 font-mono bg-cyan-500/10 border border-cyan-500/20 rounded px-3 py-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" />
                    Walk phase queued — activates after current green
                  </div>
                )}
                <Button
                  onClick={handlePedestrianRequest}
                  disabled={walkQueued}
                  variant="outline"
                  className="w-full border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 font-mono tracking-wider text-xs"
                >
                  {walkQueued ? "🚶 WALK PHASE QUEUED..." : "🚶 REQUEST PEDESTRIAN WALK"}
                </Button>
              </CardContent>
            </Card>

          {/* Congestion Spike Simulator */}
            <Card className="bg-orange-950/20 border-orange-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold tracking-widest text-orange-400 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" /> CONGESTION SPIKE SIMULATOR
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Fire a demo traffic spike to test the real-time alert system.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Target Lane</Label>
                    <Select value={spikeLane} onValueChange={setSpikeLane}>
                      <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANE_NAMES.map((name, i) => (
                          <SelectItem key={i} value={i.toString()} className="font-mono text-sm">{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Severity</Label>
                    <Select value={spikeLevel} onValueChange={v => setSpikeLevel(v as "high" | "critical")}>
                      <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">🟠 High</SelectItem>
                        <SelectItem value="critical">🔴 Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {stats?.active_spike && (
                  <div className="text-[10px] text-orange-400 font-mono bg-orange-500/10 border border-orange-500/20 rounded px-3 py-2">
                    ⚡ Active spike on {LANE_NAMES[stats.active_spike.lane_id]} — {stats.active_spike.density}% density — expires in {stats.active_spike.expires_in}s
                  </div>
                )}
                <Button
                  onClick={handleSpike}
                  disabled={spiking}
                  variant="outline"
                  className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-mono tracking-wider text-xs"
                >
                  {spiking ? "FIRING..." : `⚡ FIRE ${spikeLevel.toUpperCase()} SPIKE`}
                </Button>
              </CardContent>
            </Card>

            {/* System Health */}
            <Card className="bg-card/40 backdrop-blur border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> SYSTEM HEALTH
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: "Server Uptime", icon: Clock, value: statsLoading ? "—" : formatUptime(stats?.uptime_seconds ?? 0), color: "green" },
                    { label: "DB Records", icon: Database, value: statsLoading ? "—" : (stats?.db_rows ?? 0).toLocaleString(), color: "blue" },
                    { label: "AI Mode", icon: BrainCircuit, value: signals?.ai_mode ? "Enabled" : "Disabled", color: signals?.ai_mode ? "primary" : "muted" },
                    { label: "Active Spike", icon: Zap, value: stats?.active_spike ? `Lane ${stats.active_spike.lane_id} — ${stats.active_spike.density}%` : "None", color: stats?.active_spike ? "orange" : "muted" },
                  ].map(({ label, icon: Icon, value, color }) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </div>
                      <span className={`text-xs font-mono text-${color}-400`}>{value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}
