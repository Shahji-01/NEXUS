/**
 * Predictive Incident Detector
 * Watches per-lane speed and density history to detect anomalies
 * before operators receive manual reports.
 */

export type IncidentSeverity = "warning" | "critical";
export type IncidentStatus = "active" | "resolved";
export type IncidentType = "speed_anomaly" | "density_spike" | "sudden_stop" | "flow_breakdown";

export interface DetectedIncident {
  id: string;
  lane_id: number;
  lane_name: string;
  detected_at: string;
  resolved_at: string | null;
  status: IncidentStatus;
  severity: IncidentSeverity;
  type: IncidentType;
  description: string;
  speed_at_detection: number;
  density_at_detection: number;
  confidence: number;
}

const LANE_NAMES = ["North Bound", "South Bound", "East Bound", "West Bound"];
const HISTORY_LEN = 10;

class IncidentDetector {
  private _speedHistory: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };
  private _densityHistory: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };
  private _activeIncidents: Map<string, DetectedIncident> = new Map();
  private _resolvedIncidents: DetectedIncident[] = [];
  private _idCounter = 1;

  feed(laneId: number, speed: number, density: number): DetectedIncident | null {
    const sHist = (this._speedHistory[laneId] ??= []);
    const dHist = (this._densityHistory[laneId] ??= []);

    sHist.push(speed);
    dHist.push(density);
    if (sHist.length > HISTORY_LEN) sHist.shift();
    if (dHist.length > HISTORY_LEN) dHist.shift();

    if (sHist.length < 4) return null;

    const window = sHist.slice(-5, -1);
    const prevAvgSpeed = window.reduce((s, v) => s + v, 0) / window.length;
    const dWindow = dHist.slice(-5, -1);
    const prevAvgDensity = dWindow.reduce((s, v) => s + v, 0) / dWindow.length;

    const speedDrop = prevAvgSpeed > 0 ? (prevAvgSpeed - speed) / prevAvgSpeed : 0;
    const densitySpike = prevAvgDensity > 0 ? (density - prevAvgDensity) / prevAvgDensity : 0;

    const incidentKey = `lane_${laneId}`;
    const existing = this._activeIncidents.get(incidentKey);

    if (existing) {
      if (speedDrop < 0.08 && density < 45) {
        const resolved: DetectedIncident = {
          ...existing,
          status: "resolved",
          resolved_at: new Date().toISOString(),
        };
        this._activeIncidents.delete(incidentKey);
        this._resolvedIncidents.unshift(resolved);
        if (this._resolvedIncidents.length > 50) this._resolvedIncidents.pop();
      }
      return null;
    }

    let type: IncidentType | null = null;
    let severity: IncidentSeverity = "warning";
    let confidence = 0;

    if (speedDrop > 0.45 && density > 60) {
      type = "sudden_stop";
      severity = "critical";
      confidence = Math.min(0.99, 0.72 + speedDrop * 0.45);
    } else if (speedDrop > 0.28 && density > 40) {
      type = "speed_anomaly";
      severity = "warning";
      confidence = Math.min(0.95, 0.54 + speedDrop * 0.60);
    } else if (densitySpike > 0.50 && density > 70) {
      type = "flow_breakdown";
      severity = "critical";
      confidence = Math.min(0.97, 0.65 + densitySpike * 0.28);
    } else if (densitySpike > 0.32 && density > 52) {
      type = "density_spike";
      severity = "warning";
      confidence = Math.min(0.90, 0.48 + densitySpike * 0.40);
    }

    if (!type) return null;

    const descriptions: Record<IncidentType, string> = {
      sudden_stop: `Sudden halt — speed dropped ${Math.round(speedDrop * 100)}% in under 30 s`,
      speed_anomaly: `Speed fell ${Math.round(speedDrop * 100)}% below baseline — possible obstruction`,
      flow_breakdown: `Flow breakdown — density surged ${Math.round(densitySpike * 100)}% above baseline`,
      density_spike: `Density surge to ${Math.round(density)}% — monitoring for escalation`,
    };

    const incident: DetectedIncident = {
      id: `INC-${String(this._idCounter++).padStart(4, "0")}`,
      lane_id: laneId,
      lane_name: LANE_NAMES[laneId] ?? `Lane ${laneId}`,
      detected_at: new Date().toISOString(),
      resolved_at: null,
      status: "active",
      severity,
      type,
      description: descriptions[type],
      speed_at_detection: Math.round(speed * 10) / 10,
      density_at_detection: Math.round(density * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };

    this._activeIncidents.set(incidentKey, incident);
    return incident;
  }

  getActive(): DetectedIncident[] {
    return Array.from(this._activeIncidents.values());
  }

  getResolved(): DetectedIncident[] {
    return this._resolvedIncidents.slice(0, 30);
  }

  getAll(): DetectedIncident[] {
    return [...this.getActive(), ...this.getResolved()];
  }
}

export const incidentDetector = new IncidentDetector();
