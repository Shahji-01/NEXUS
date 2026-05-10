/**
 * School Zone & Event-Aware Signal Scheduler
 * Defines time-of-day signal plans and calendar events.
 * The active plan is surfaced to the frontend and can also influence
 * simulation parameters if wired into the tick loop.
 */

export type PlanId =
  | "night"
  | "school_morning"
  | "morning_rush"
  | "midday"
  | "school_afternoon"
  | "evening_rush"
  | "late_evening"
  | "event";

export interface SignalPlan {
  id: PlanId;
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

export type EventType = "school" | "sports" | "cultural" | "construction" | "vip";

export interface ScheduledEvent {
  id: string;
  name: string;
  type: EventType;
  plan_id: PlanId;
  start_hour: number;
  end_hour: number;
  days: number[];
  location: string;
  active: boolean;
}

export interface ActiveSchedule {
  current_plan: SignalPlan;
  next_plan: SignalPlan | null;
  next_plan_starts_at: string | null;
  active_events: ScheduledEvent[];
  upcoming_events: ScheduledEvent[];
  override_reason: string | null;
}

const PLANS: Record<PlanId, SignalPlan> = {
  night: {
    id: "night", name: "Night Mode",
    description: "Minimal traffic — fast cycles, longer pedestrian phases",
    pedestrian_priority: false, school_zone_active: false, max_speed_kmh: 60,
    green_extension_pct: 0,  pedestrian_phase_freq_s: 120, min_green_s: 10, max_green_s: 40,
    color: "#6366f1", icon: "🌙",
  },
  school_morning: {
    id: "school_morning", name: "School Morning",
    description: "Heavy pedestrian activity — extended walk phases, 30 km/h zone",
    pedestrian_priority: true, school_zone_active: true, max_speed_kmh: 30,
    green_extension_pct: 20, pedestrian_phase_freq_s: 30, min_green_s: 20, max_green_s: 60,
    color: "#f59e0b", icon: "🏫",
  },
  morning_rush: {
    id: "morning_rush", name: "Morning Rush",
    description: "High inbound flow — long green phases for main corridors",
    pedestrian_priority: false, school_zone_active: false, max_speed_kmh: 50,
    green_extension_pct: 30, pedestrian_phase_freq_s: 90, min_green_s: 20, max_green_s: 90,
    color: "#ef4444", icon: "🌅",
  },
  midday: {
    id: "midday", name: "Midday Standard",
    description: "Balanced flow — default adaptive timing",
    pedestrian_priority: false, school_zone_active: false, max_speed_kmh: 50,
    green_extension_pct: 10, pedestrian_phase_freq_s: 60, min_green_s: 15, max_green_s: 70,
    color: "#22d3ee", icon: "☀️",
  },
  school_afternoon: {
    id: "school_afternoon", name: "School Afternoon",
    description: "School pickup rush — pedestrian priority, reduced speed",
    pedestrian_priority: true, school_zone_active: true, max_speed_kmh: 30,
    green_extension_pct: 15, pedestrian_phase_freq_s: 35, min_green_s: 18, max_green_s: 55,
    color: "#fb923c", icon: "🎒",
  },
  evening_rush: {
    id: "evening_rush", name: "Evening Rush",
    description: "Peak outbound — maximise throughput, bus priority active",
    pedestrian_priority: false, school_zone_active: false, max_speed_kmh: 50,
    green_extension_pct: 35, pedestrian_phase_freq_s: 90, min_green_s: 25, max_green_s: 90,
    color: "#f97316", icon: "🌆",
  },
  late_evening: {
    id: "late_evening", name: "Late Evening",
    description: "Winding down — moderate timing, pedestrian safety focus",
    pedestrian_priority: true, school_zone_active: false, max_speed_kmh: 50,
    green_extension_pct: 5,  pedestrian_phase_freq_s: 50, min_green_s: 12, max_green_s: 55,
    color: "#a78bfa", icon: "🌃",
  },
  event: {
    id: "event", name: "Special Event",
    description: "Custom event plan — crowd management, increased pedestrian capacity",
    pedestrian_priority: true, school_zone_active: false, max_speed_kmh: 40,
    green_extension_pct: 25, pedestrian_phase_freq_s: 40, min_green_s: 20, max_green_s: 80,
    color: "#ec4899", icon: "🎉",
  },
};

const DEFAULT_EVENTS: ScheduledEvent[] = [
  {
    id: "e1", name: "DPS School Zone — Drop-off", type: "school", plan_id: "school_morning",
    start_hour: 7, end_hour: 9, days: [1,2,3,4,5], location: "North Bound", active: true,
  },
  {
    id: "e2", name: "DPS School Zone — Pick-up", type: "school", plan_id: "school_afternoon",
    start_hour: 14, end_hour: 16, days: [1,2,3,4,5], location: "North Bound", active: true,
  },
  {
    id: "e3", name: "Weekend Stadium Match", type: "sports", plan_id: "event",
    start_hour: 17, end_hour: 22, days: [0, 6], location: "East Bound", active: true,
  },
  {
    id: "e4", name: "Road Construction — Outer Ring", type: "construction", plan_id: "midday",
    start_hour: 9, end_hour: 17, days: [1,2,3,4,5], location: "West Bound", active: false,
  },
];

let _events: ScheduledEvent[] = [...DEFAULT_EVENTS];

function getPlanForHour(
  hour: number,
  day: number,
): { plan: SignalPlan; event?: ScheduledEvent } {
  const activeEvent = _events.find(
    (e) =>
      e.active &&
      e.days.includes(day) &&
      hour >= e.start_hour &&
      hour < e.end_hour,
  );
  if (activeEvent) return { plan: PLANS[activeEvent.plan_id], event: activeEvent };

  if (hour >= 0  && hour < 5)  return { plan: PLANS["night"] };
  if (hour >= 5  && hour < 7)  return { plan: PLANS["late_evening"] };
  if (hour >= 7  && hour < 10) return { plan: PLANS["morning_rush"] };
  if (hour >= 10 && hour < 14) return { plan: PLANS["midday"] };
  if (hour >= 14 && hour < 17) return { plan: PLANS["midday"] };
  if (hour >= 17 && hour < 21) return { plan: PLANS["evening_rush"] };
  return { plan: PLANS["late_evening"] };
}

export function getActiveSchedule(): ActiveSchedule {
  const now   = new Date();
  const hour  = now.getHours();
  const day   = now.getDay();

  const { plan: current, event } = getPlanForHour(hour, day);

  const nextHour = (hour + 1) % 24;
  const { plan: next } = getPlanForHour(nextHour, day);
  const nextStartsAt = new Date(now);
  nextStartsAt.setHours(nextHour, 0, 0, 0);

  const activeEvents = _events.filter(
    (e) => e.active && e.days.includes(day) && hour >= e.start_hour && hour < e.end_hour,
  );
  const upcomingEvents = _events.filter(
    (e) => e.active && e.days.includes(day) && e.start_hour > hour && e.start_hour <= hour + 4,
  );

  return {
    current_plan: current,
    next_plan: next.id !== current.id ? next : null,
    next_plan_starts_at: next.id !== current.id ? nextStartsAt.toISOString() : null,
    active_events: activeEvents,
    upcoming_events: upcomingEvents,
    override_reason: event ? event.name : null,
  };
}

export function getAllPlans(): SignalPlan[] {
  return Object.values(PLANS);
}

export function getAllEvents(): ScheduledEvent[] {
  return _events;
}

export function getDaySchedule(day: number): { hour: number; plan: SignalPlan }[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    plan: getPlanForHour(h, day).plan,
  }));
}

export function addEvent(event: Omit<ScheduledEvent, "id">): ScheduledEvent {
  const newEvent: ScheduledEvent = { ...event, id: `e${Date.now()}` };
  _events.push(newEvent);
  return newEvent;
}

export function toggleEvent(id: string): boolean {
  const ev = _events.find((e) => e.id === id);
  if (!ev) return false;
  ev.active = !ev.active;
  return ev.active;
}
