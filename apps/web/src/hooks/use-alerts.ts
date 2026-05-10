import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTrafficStore } from '@/lib/store';
import type { WeatherCondition } from '@/lib/store';
import type { LiveTrafficStateLanes, SignalState } from '@workspace/api-client-react';

const LANE_LABELS: Record<number, string> = {
  0: 'North Bound', 1: 'South Bound', 2: 'East Bound', 3: 'West Bound',
};

const EMERG_ICONS: Record<string, string> = {
  ambulance: '🚑', fire_truck: '🚒', police: '🚓',
};

const SEVERITY_ORDER: Record<string, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

function isSevere(level: string) {
  return level === 'high' || level === 'critical';
}

export function useAlerts() {
  const { lanes, signals, activeEmergency, weather, addAlert } = useTrafficStore();

  // Initialize refs to current values so first-render comparisons produce no alerts
  const prevLanesRef = useRef<LiveTrafficStateLanes>(lanes);
  const prevEmergencyRef = useRef<string | null>(activeEmergency?.id?.toString() ?? null);
  const prevSignalsRef = useRef<SignalState | null>(signals);
  const prevWeatherRef = useRef<WeatherCondition | null>(weather);
  const mountedRef = useRef(false);

  // Lane congestion transitions
  useEffect(() => {
    if (!mountedRef.current) {
      prevLanesRef.current = lanes;
      return;
    }
    const prevLanes = prevLanesRef.current;

    for (let id = 0; id <= 3; id++) {
      const curr = lanes[id];
      const prev = prevLanes[id];
      if (!curr || !prev) continue;

      const currLevel = curr.congestion_level ?? 'low';
      const prevLevel = prev.congestion_level ?? 'low';
      if (currLevel === prevLevel) continue;

      const currSev = SEVERITY_ORDER[currLevel] ?? 0;
      const prevSev = SEVERITY_ORDER[prevLevel] ?? 0;
      const laneLabel = LANE_LABELS[id] ?? `Lane ${id}`;

      if (isSevere(currLevel) && currSev > prevSev) {
        const isCritical = currLevel === 'critical';
        const title = isCritical
          ? `Critical congestion — ${laneLabel}`
          : `High congestion — ${laneLabel}`;
        const description = `${Math.round(curr.density ?? 0)}% density · ${curr.vehicle_count ?? 0} vehicles`;
        addAlert({ type: 'congestion', severity: isCritical ? 'critical' : 'warning', title, description, lane: id });
        if (isCritical) {
          toast.error(title, { description, duration: 8000, icon: '🔴' });
        } else {
          toast.warning(title, { description, duration: 6000, icon: '🟠' });
        }
      } else if (!isSevere(currLevel) && isSevere(prevLevel)) {
        const title = `${laneLabel} congestion cleared`;
        const description = `Back to ${currLevel} · ${Math.round(curr.density ?? 0)}% density`;
        addAlert({ type: 'recovery', severity: 'info', title, description, lane: id });
        toast.success(title, { description, duration: 4000, icon: '✅' });
      }
    }

    prevLanesRef.current = lanes;
  }, [lanes, addAlert]);

  // Emergency detection + resolution
  useEffect(() => {
    if (!mountedRef.current) {
      prevEmergencyRef.current = activeEmergency?.id?.toString() ?? null;
      return;
    }
    const emergId = activeEmergency?.id?.toString() ?? null;
    const prevId = prevEmergencyRef.current;

    if (emergId && emergId !== prevId) {
      const type = activeEmergency?.vehicle_type ?? 'vehicle';
      const lane = LANE_LABELS[activeEmergency?.lane_id as number] ?? 'Unknown';
      const iconKey = type.toLowerCase().replace(/\s+/g, '_');
      const icon = EMERG_ICONS[iconKey] ?? '🚨';
      const title = `Emergency: ${type.toUpperCase()} detected`;
      const description = `${lane} · ${Math.round((activeEmergency?.confidence ?? 0) * 100)}% confidence`;
      addAlert({ type: 'emergency', severity: 'critical', title, description, lane: activeEmergency?.lane_id as number });
      toast.error(title, {
        description, duration: 12000, icon,
        action: { label: 'View', onClick: () => { window.location.href = '/emergency'; } },
      });
    }

    if (!emergId && prevId !== null) {
      addAlert({ type: 'resolution', severity: 'info', title: 'Emergency cleared', description: 'System returning to normal operation' });
      toast.success('Emergency cleared', { description: 'System returning to normal operation', duration: 5000, icon: '🟢' });
    }

    prevEmergencyRef.current = emergId;
  }, [activeEmergency, addAlert]);

  // Signal preemption + AI mode toggle
  useEffect(() => {
    if (!mountedRef.current) {
      prevSignalsRef.current = signals;
      return;
    }
    const prev = prevSignalsRef.current;
    if (!prev || !signals) {
      prevSignalsRef.current = signals;
      return;
    }

    if (signals.emergency_active && !prev.emergency_active) {
      const lane = signals.emergency_lane !== undefined
        ? (LANE_LABELS[signals.emergency_lane as number] ?? `Lane ${signals.emergency_lane}`)
        : 'Unknown';
      addAlert({
        type: 'signal_override', severity: 'critical',
        title: 'Emergency preemption active',
        description: `${lane} granted unconditional green`,
        lane: signals.emergency_lane as number,
      });
    }

    if (!signals.emergency_active && prev.emergency_active) {
      addAlert({ type: 'signal_override', severity: 'info', title: 'Signal control restored', description: 'Resuming normal cycle operation' });
    }

    if (signals.ai_mode !== prev.ai_mode) {
      const on = signals.ai_mode;
      addAlert({
        type: 'system', severity: 'info',
        title: on ? 'AI mode enabled' : 'AI mode disabled',
        description: on ? 'Adaptive cycle optimization active' : 'Manual signal control active',
      });
      toast.info(on ? 'AI Optimization ON' : 'AI Optimization OFF', {
        description: on ? 'Adaptive cycles now active' : 'Switched to manual control',
        duration: 4000, icon: '🤖',
      });
    }

    prevSignalsRef.current = signals;
  }, [signals, addAlert]);

  // Weather condition changes
  useEffect(() => {
    if (!mountedRef.current) {
      prevWeatherRef.current = weather;
      return;
    }
    const prev = prevWeatherRef.current;
    if (!weather || !prev || weather.code === prev.code) {
      prevWeatherRef.current = weather;
      return;
    }

    // Condition label changed
    const title = `Weather: ${weather.label}`;
    const parts: string[] = [];
    if (weather.green_extension_sec > 0) parts.push(`+${weather.green_extension_sec}s green extension`);
    if (weather.speed_factor < 0.98) parts.push(`speed reduced to ${Math.round(weather.speed_factor * 100)}%`);
    const description = parts.length > 0 ? parts.join(' · ') : 'No traffic impact';

    const severity = weather.severe ? 'warning' : 'info';
    addAlert({ type: 'weather', severity, title, description });

    if (weather.severe && !prev.severe) {
      toast.warning(title, { description, duration: 8000, icon: weather.icon });
    } else if (!weather.severe && prev.severe) {
      toast.success(`Conditions improving: ${weather.label}`, { description, duration: 5000, icon: weather.icon });
    } else {
      toast.info(title, { description, duration: 4000, icon: weather.icon });
    }

    prevWeatherRef.current = weather;
  }, [weather, addAlert]);

  // Mark as mounted after all effects have registered (runs last on first render)
  useEffect(() => {
    mountedRef.current = true;
  }, []);
}
