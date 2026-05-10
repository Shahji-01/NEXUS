import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Calendar, Clock, ChevronRight, PersonStanding, School, Star, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

import { API_URL as BASE } from "@/lib/api";

interface SignalPlan {
  id: string;
  name: string;
  description: string;
  pedestrian_priority: boolean;
  school_zone_active: boolean;
  max_speed_kmh: number;
  green_extension_pct: number;
  pedestrian_phase_freq_s: number;
  min_green_s: number;
  max_green_s: number;
  color: string;
  icon: string;
}

interface ScheduledEvent {
  id: string;
  name: string;
  type: string;
  plan_id: string;
  start_hour: number;
  end_hour: number;
  days: number[];
  location: string;
  active: boolean;
}

interface ActiveSchedule {
  current_plan: SignalPlan;
  next_plan: SignalPlan | null;
  next_plan_starts_at: string | null;
  active_events: ScheduledEvent[];
  upcoming_events: ScheduledEvent[];
  override_reason: string | null;
}

interface DaySlot { hour: number; plan: SignalPlan }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

const EVENT_TYPE_ICONS: Record<string, string> = {
  school: "🏫", sports: "⚽", cultural: "🎭", construction: "🚧", vip: "⭐",
};

export default function SchedulePage() {
  const [active, setActive] = useState<ActiveSchedule | null>(null);
  const [daySchedule, setDaySchedule] = useState<DaySlot[]>([]);
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());

  const fetchAll = () => {
    fetch(`${BASE}/schedule/active`)
      .then(r => r.json()).then(setActive).catch(() => {});
    fetch(`${BASE}/schedule/events`)
      .then(r => r.json()).then(d => setEvents(d.events ?? [])).catch(() => {});
  };

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 10000); return () => clearInterval(id); }, []);

  useEffect(() => {
    fetch(`${BASE}/schedule/day?day=${selectedDay}`)
      .then(r => r.json())
      .then(d => setDaySchedule(d.schedule ?? []))
      .catch(() => {});
  }, [selectedDay]);

  const handleToggleEvent = (id: string) => {
    fetch(`${BASE}/schedule/events/${id}/toggle`, { method: "POST" })
      .then(() => fetchAll())
      .catch(() => {});
  };

  const currentPlan = active?.current_plan;

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Smart Signal Scheduling</h2>
            <p className="text-xs text-muted-foreground">Time-of-day & event-aware plans — school zones, rush hours, special events</p>
          </div>
          <div className="ml-auto text-xs text-muted-foreground font-mono">
            {format(new Date(), "HH:mm:ss")}
          </div>
        </div>

        {currentPlan && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-2" style={{ borderColor: `${currentPlan.color}40`, background: `${currentPlan.color}08` }}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="text-3xl">{currentPlan.icon}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{currentPlan.name}</span>
                      <Badge className="text-[10px] px-1.5 py-0" style={{ background: `${currentPlan.color}20`, color: currentPlan.color, borderColor: `${currentPlan.color}40` }}>
                        ACTIVE
                      </Badge>
                      {active?.override_reason && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground">
                          Override: {active.override_reason}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{currentPlan.description}</p>
                    <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-mono">
                      {[
                        { label: "Max Speed", value: `${currentPlan.max_speed_kmh} km/h` },
                        { label: "Green Range", value: `${currentPlan.min_green_s}–${currentPlan.max_green_s}s` },
                        { label: "Green Ext.", value: `+${currentPlan.green_extension_pct}%` },
                        { label: "Ped Freq", value: `${currentPlan.pedestrian_phase_freq_s}s` },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-black/10 rounded px-2 py-1">
                          <span className="text-muted-foreground">{label}: </span>
                          <span className="text-foreground">{value}</span>
                        </div>
                      ))}
                      {currentPlan.pedestrian_priority && (
                        <div className="flex items-center gap-1 text-yellow-400">
                          <PersonStanding className="w-3 h-3" /> Pedestrian Priority
                        </div>
                      )}
                      {currentPlan.school_zone_active && (
                        <div className="flex items-center gap-1 text-amber-400">
                          <School className="w-3 h-3" /> School Zone Active
                        </div>
                      )}
                    </div>
                  </div>
                  {active?.next_plan && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">Next plan</p>
                      <div className="flex items-center gap-1 mt-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-medium">{active.next_plan.icon} {active.next_plan.name}</span>
                      </div>
                      {active.next_plan_starts_at && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          at {format(new Date(active.next_plan_starts_at), "HH:mm")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {(active?.active_events?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Active Events</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {active!.active_events.map(ev => (
                <Card key={ev.id} className="bg-green-500/5 border-green-500/30">
                  <CardContent className="p-3 flex items-center gap-2">
                    <span className="text-lg">{EVENT_TYPE_ICONS[ev.type] ?? "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{ev.name}</p>
                      <p className="text-[10px] text-muted-foreground">{ev.location} · {ev.start_hour}:00–{ev.end_hour}:00</p>
                    </div>
                    <Badge className="text-[9px] px-1 py-0 bg-green-500/20 text-green-400 border-green-500/40 shrink-0">LIVE</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {(active?.upcoming_events?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Upcoming (next 4h)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {active!.upcoming_events.map(ev => (
                <Card key={ev.id} className="bg-card/30 border-border/40">
                  <CardContent className="p-3 flex items-center gap-2">
                    <span className="text-lg">{EVENT_TYPE_ICONS[ev.type] ?? "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{ev.name}</p>
                      <p className="text-[10px] text-muted-foreground">{ev.location} · starts {ev.start_hour}:00</p>
                    </div>
                    <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">24-Hour Plan View</CardTitle>
              <div className="flex gap-1">
                {DAY_NAMES.map((d, i) => (
                  <Button key={d} variant={selectedDay === i ? "default" : "ghost"} size="sm"
                    className="h-6 px-2 text-[10px]" onClick={() => setSelectedDay(i)}>
                    {d}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {daySchedule.length === 0 ? (
              <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
            ) : (
              <div className="flex gap-0.5 h-12 rounded-lg overflow-hidden">
                {daySchedule.map(({ hour, plan }) => {
                  const isNow = new Date().getDay() === selectedDay && new Date().getHours() === hour;
                  return (
                    <div
                      key={hour}
                      className={cn("flex-1 relative group", isNow && "ring-1 ring-white/40")}
                      style={{ backgroundColor: `${plan.color}${isNow ? "ee" : "66"}` }}
                      title={`${HOUR_LABELS[hour]} — ${plan.name}`}
                    >
                      {isNow && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-0.5 h-full bg-white/70" />
                        </div>
                      )}
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                        <div className="bg-card border border-border rounded px-2 py-1 text-[9px] whitespace-nowrap shadow-lg">
                          {HOUR_LABELS[hour]} {plan.icon} {plan.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex gap-3 mt-3 flex-wrap">
              {Array.from(new Set(daySchedule.map(s => s.plan.id))).map(planId => {
                const plan = daySchedule.find(s => s.plan.id === planId)?.plan;
                if (!plan) return null;
                return (
                  <div key={planId} className="flex items-center gap-1.5 text-[10px]">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: plan.color }} />
                    <span>{plan.icon} {plan.name}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Scheduled Events</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {events.map(ev => (
              <div key={ev.id} className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all",
                ev.active ? "border-border/50 bg-muted/10" : "border-border/20 bg-muted/5 opacity-50",
              )}>
                <span className="text-xl shrink-0">{EVENT_TYPE_ICONS[ev.type] ?? "📋"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ev.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {ev.location} · {DAY_NAMES.filter((_, i) => ev.days.includes(i)).join(", ")} · {ev.start_hour}:00–{ev.end_hour}:00
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border/50">
                    {ev.plan_id.replace(/_/g, " ")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("h-6 px-2 text-[10px]", ev.active ? "text-green-400 hover:text-red-400" : "text-muted-foreground hover:text-green-400")}
                    onClick={() => handleToggleEvent(ev.id)}
                  >
                    {ev.active ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
