import { create } from 'zustand';
import type { LiveTrafficStateLanes, SignalState, EmergencyEvent } from '@workspace/api-client-react';

export interface WeatherCondition {
  code: number;
  label: string;
  icon: string;
  temperature_c: number;
  wind_kmh: number;
  rain_mm: number;
  speed_factor: number;
  density_factor: number;
  green_extension_sec: number;
  severe: boolean;
  last_fetched: string;
}

export interface AlertItem {
  id: string;
  type: 'congestion' | 'emergency' | 'recovery' | 'signal_override' | 'resolution' | 'system' | 'weather';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  lane?: number;
}

interface TrafficStore {
  lanes: LiveTrafficStateLanes;
  signals: SignalState | null;
  activeEmergency: EmergencyEvent | null;
  weather: WeatherCondition | null;
  pressureScores: Record<number, number>;
  adaptiveCycleBudgetSec: number;
  pedestrianWalkActive: boolean;
  connected: boolean;
  lastUpdate: string | null;
  alerts: AlertItem[];
  unreadCount: number;
  copilotOpen: boolean;
  setConnected: (connected: boolean) => void;
  updateData: (data: any) => void;
  addAlert: (alert: Omit<AlertItem, 'id' | 'timestamp' | 'read'>) => void;
  markAllRead: () => void;
  clearAlerts: () => void;
  setCopilotOpen: (open: boolean) => void;
}

let alertIdCounter = 0;

export const useTrafficStore = create<TrafficStore>((set) => ({
  lanes: {},
  signals: null,
  activeEmergency: null,
  weather: null,
  pressureScores: {},
  adaptiveCycleBudgetSec: 60,
  pedestrianWalkActive: false,
  connected: false,
  lastUpdate: null,
  alerts: [],
  unreadCount: 0,
  copilotOpen: false,
  setConnected: (connected) => set({ connected }),
  updateData: (data) => set((state) => ({
    lanes: data.lanes || state.lanes,
    signals: data.signals || state.signals,
    activeEmergency: data.emergency !== undefined ? data.emergency : state.activeEmergency,
    weather: data.weather !== undefined ? data.weather : state.weather,
    pressureScores: data.pressure_scores ?? state.pressureScores,
    adaptiveCycleBudgetSec: data.adaptive_cycle_budget_sec ?? state.adaptiveCycleBudgetSec,
    pedestrianWalkActive: data.pedestrian_walk_active ?? state.pedestrianWalkActive,
    lastUpdate: data.timestamp || new Date().toISOString(),
  })),
  addAlert: (alert) => set((state) => {
    const newAlert: AlertItem = {
      ...alert,
      id: String(++alertIdCounter),
      timestamp: new Date().toISOString(),
      read: false,
    };
    const alerts = [newAlert, ...state.alerts].slice(0, 80);
    return { alerts, unreadCount: alerts.filter(a => !a.read).length };
  }),
  markAllRead: () => set((state) => ({
    alerts: state.alerts.map(a => ({ ...a, read: true })),
    unreadCount: 0,
  })),
  clearAlerts: () => set({ alerts: [], unreadCount: 0 }),
  setCopilotOpen: (open) => set({ copilotOpen: open }),
}));
