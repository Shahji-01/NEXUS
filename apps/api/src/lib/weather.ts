/**
 * WeatherService — polls Open-Meteo (free, no API key) every 10 minutes.
 * Derives traffic impact factors used by the simulation engine.
 *
 * Coordinates: New Delhi, India (28.6139, 77.2090).
 * Swap to any city by changing LAT / LON.
 */

import { logger } from "./logger";

const LAT = 28.6139;
const LON = 77.2090;
const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface WeatherCondition {
  code: number;
  label: string;
  icon: string;
  temperature_c: number;
  wind_kmh: number;
  rain_mm: number;
  /** 0.60 – 1.00: multiplier applied to avg_speed */
  speed_factor: number;
  /** 1.00 – 1.50: multiplier applied to density */
  density_factor: number;
  /** extra seconds added to green phase */
  green_extension_sec: number;
  /** true when conditions warrant a dashboard alert */
  severe: boolean;
  last_fetched: string;
}

interface OpenMeteoResponse {
  current: {
    weather_code: number;
    temperature_2m: number;
    wind_speed_10m: number;
    rain: number;
  };
}

function classifyWMO(code: number): {
  label: string;
  icon: string;
  speed_factor: number;
  density_factor: number;
  green_extension_sec: number;
  severe: boolean;
} {
  // WMO 4677 weather codes
  if (code === 0)                       return { label: "Clear",          icon: "☀️",  speed_factor: 1.00, density_factor: 1.00, green_extension_sec: 0,  severe: false };
  if (code <= 3)                        return { label: "Partly Cloudy",  icon: "⛅",  speed_factor: 1.00, density_factor: 1.00, green_extension_sec: 0,  severe: false };
  if (code === 45 || code === 48)       return { label: "Fog",            icon: "🌫️", speed_factor: 0.72, density_factor: 1.18, green_extension_sec: 7,  severe: true  };
  if (code >= 51 && code <= 55)         return { label: "Drizzle",        icon: "🌦️", speed_factor: 0.90, density_factor: 1.06, green_extension_sec: 3,  severe: false };
  if (code === 56 || code === 57)       return { label: "Freezing Drizzle",icon: "🌨️",speed_factor: 0.70, density_factor: 1.30, green_extension_sec: 8,  severe: true  };
  if (code >= 61 && code <= 63)         return { label: "Rain",           icon: "🌧️", speed_factor: 0.82, density_factor: 1.20, green_extension_sec: 5,  severe: false };
  if (code === 65)                      return { label: "Heavy Rain",     icon: "🌧️", speed_factor: 0.72, density_factor: 1.35, green_extension_sec: 8,  severe: true  };
  if (code === 66 || code === 67)       return { label: "Freezing Rain",  icon: "🧊",  speed_factor: 0.62, density_factor: 1.40, green_extension_sec: 10, severe: true  };
  if (code >= 71 && code <= 75)         return { label: "Snow",           icon: "❄️",  speed_factor: 0.60, density_factor: 1.45, green_extension_sec: 12, severe: true  };
  if (code === 77)                      return { label: "Sleet",          icon: "🌨️", speed_factor: 0.65, density_factor: 1.40, green_extension_sec: 10, severe: true  };
  if (code >= 80 && code <= 82)         return { label: "Rain Showers",   icon: "🌦️", speed_factor: 0.84, density_factor: 1.15, green_extension_sec: 4,  severe: false };
  if (code === 85 || code === 86)       return { label: "Snow Showers",   icon: "🌨️", speed_factor: 0.62, density_factor: 1.45, green_extension_sec: 12, severe: true  };
  if (code >= 95 && code <= 99)         return { label: "Thunderstorm",   icon: "⛈️",  speed_factor: 0.65, density_factor: 1.38, green_extension_sec: 10, severe: true  };
  return                                       { label: "Unknown",         icon: "🌡️", speed_factor: 1.00, density_factor: 1.00, green_extension_sec: 0,  severe: false };
}

const DEFAULT_WEATHER: WeatherCondition = {
  code: 0,
  label: "Clear",
  icon: "☀️",
  temperature_c: 18,
  wind_kmh: 10,
  rain_mm: 0,
  speed_factor: 1.0,
  density_factor: 1.0,
  green_extension_sec: 0,
  severe: false,
  last_fetched: new Date().toISOString(),
};

class WeatherService {
  private _current: WeatherCondition = { ...DEFAULT_WEATHER };
  private _timer: ReturnType<typeof setInterval> | null = null;

  /** Start polling immediately, then every POLL_INTERVAL_MS. */
  start(): void {
    void this._fetch();
    this._timer = setInterval(() => { void this._fetch(); }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
  }

  get(): WeatherCondition {
    return { ...this._current };
  }

  private async _fetch(): Promise<void> {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${LAT}&longitude=${LON}` +
      `&current=weather_code,temperature_2m,wind_speed_10m,rain` +
      `&wind_speed_unit=kmh&forecast_days=1`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OpenMeteoResponse;
      const c = data.current;
      const cls = classifyWMO(c.weather_code);

      const prev = this._current;
      this._current = {
        code: c.weather_code,
        temperature_c: Math.round(c.temperature_2m * 10) / 10,
        wind_kmh: Math.round(c.wind_speed_10m * 10) / 10,
        rain_mm: Math.round((c.rain ?? 0) * 10) / 10,
        last_fetched: new Date().toISOString(),
        ...cls,
      };

      if (prev.code !== this._current.code) {
        logger.info(
          { from: prev.label, to: this._current.label, code: this._current.code,
            speed_factor: this._current.speed_factor, green_ext: this._current.green_extension_sec },
          "Weather updated"
        );
      }
    } catch (err) {
      logger.warn({ err }, "Weather fetch failed — keeping last known state");
    }
  }
}

export const weatherService = new WeatherService();
