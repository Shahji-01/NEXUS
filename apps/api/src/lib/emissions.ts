/**
 * Carbon Emissions Live Counter
 * Compares real-time idle time against a fixed-signal baseline.
 * Emission factors from ICCT / EPA standard urban traffic data.
 */

const CO2_IDLE_G_PER_SECOND = 0.05;
const BASELINE_IDLE_FRACTION = 0.55;
const TREE_CO2_KG_PER_DAY = 21.7 / 365;

export interface EmissionsSnapshot {
  timestamp: number;
  current_idle_pct: number;
  baseline_idle_pct: number;
  co2_saved_g_this_tick: number;
  co2_saved_kg_total: number;
  co2_saved_kg_today: number;
  trees_equivalent: number;
  cars_removed_equivalent: number;
  idle_time_saved_s_today: number;
}

class EmissionsCalculator {
  private sessionStart = Date.now() / 1000;
  private dayStart = Date.now() / 1000;
  private totalSavedG = 0;
  private todaySavedG = 0;
  private lastTick = Date.now() / 1000;
  private lastSnapshot: EmissionsSnapshot | null = null;

  tick(lanes: { density?: number; vehicle_count?: number; congestion_level?: string }[]): EmissionsSnapshot {
    const now = Date.now() / 1000;
    const elapsedS = now - this.lastTick;
    this.lastTick = now;

    // Reset day counter every 24h
    if (now - this.dayStart > 86400) {
      this.todaySavedG = 0;
      this.dayStart = now;
    }

    // Current idle fraction: use density proxy (>50% density = lane is "backing up")
    const idleFraction = lanes.length > 0
      ? lanes.filter(l => (l.density ?? 0) > 50).length / lanes.length * 0.6
      : 0.3;

    const totalVehicles = lanes.length > 0
      ? lanes.reduce((s, l) => s + (l.vehicle_count ?? 0), 0)
      : 200;

    const improvementFraction = Math.max(0, BASELINE_IDLE_FRACTION - idleFraction);
    const co2SavedG = improvementFraction * totalVehicles * CO2_IDLE_G_PER_SECOND * elapsedS;

    this.totalSavedG += co2SavedG;
    this.todaySavedG += co2SavedG;

    const totalKg = this.totalSavedG / 1000;
    const todayKg = this.todaySavedG / 1000;

    const snapshot: EmissionsSnapshot = {
      timestamp: now,
      current_idle_pct: Math.round(idleFraction * 1000) / 10,
      baseline_idle_pct: Math.round(BASELINE_IDLE_FRACTION * 1000) / 10,
      co2_saved_g_this_tick: Math.round(co2SavedG * 10000) / 10000,
      co2_saved_kg_total: Math.round(totalKg * 1000) / 1000,
      co2_saved_kg_today: Math.round(todayKg * 1000) / 1000,
      trees_equivalent: Math.round((todayKg / TREE_CO2_KG_PER_DAY) * 10) / 10,
      cars_removed_equivalent: Math.round((todayKg / 4.6) * 100) / 100,
      idle_time_saved_s_today: Math.round(
        (this.todaySavedG / CO2_IDLE_G_PER_SECOND) / Math.max(totalVehicles, 1) * 10
      ) / 10,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  getSnapshot(): EmissionsSnapshot | null {
    return this.lastSnapshot;
  }
}

export const emissionsCalculator = new EmissionsCalculator();
