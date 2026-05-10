import { useTrafficStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Wind, Thermometer, Droplets, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const IMPACT_COLOR: Record<string, string> = {
  "1.00": "text-green-400",
  "normal": "text-green-400",
};

function getSpeedImpactColor(factor: number) {
  if (factor >= 0.95) return "text-green-400";
  if (factor >= 0.80) return "text-yellow-400";
  if (factor >= 0.70) return "text-orange-400";
  return "text-red-400";
}

function getGreenExtColor(ext: number) {
  if (ext === 0) return "text-green-400";
  if (ext <= 4) return "text-yellow-400";
  if (ext <= 8) return "text-orange-400";
  return "text-red-400";
}

export function WeatherCard() {
  const { weather } = useTrafficStore();

  if (!weather) return null;

  const speedPct = Math.round(weather.speed_factor * 100);
  const densityPct = Math.round((weather.density_factor - 1) * 100);
  const isAffecting = weather.speed_factor < 0.98 || weather.green_extension_sec > 0;

  return (
    <Card className={cn(
      "bg-card/40 backdrop-blur border-border/50 transition-all duration-500",
      weather.severe && "border-orange-500/40 bg-orange-500/5"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">
            WEATHER CONDITIONS
          </CardTitle>
          {isAffecting && (
            <span className="text-[9px] font-semibold tracking-widest text-orange-400 border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 rounded">
              SIGNAL ADJUSTMENT ACTIVE
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Condition row */}
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none" role="img" aria-label={weather.label}>
            {weather.icon}
          </span>
          <div>
            <p className="font-semibold text-sm text-foreground">{weather.label}</p>
            <p className="text-[10px] text-muted-foreground">New Delhi, IN · Live data</p>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/20 rounded-md p-2">
            <div className="flex items-center gap-1 mb-1">
              <Thermometer className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Temp</span>
            </div>
            <p className="text-sm font-mono font-semibold">{weather.temperature_c}°C</p>
          </div>
          <div className="bg-muted/20 rounded-md p-2">
            <div className="flex items-center gap-1 mb-1">
              <Wind className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Wind</span>
            </div>
            <p className="text-sm font-mono font-semibold">{weather.wind_kmh} km/h</p>
          </div>
          <div className="bg-muted/20 rounded-md p-2">
            <div className="flex items-center gap-1 mb-1">
              <Droplets className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Rain</span>
            </div>
            <p className="text-sm font-mono font-semibold">{weather.rain_mm} mm</p>
          </div>
        </div>

        {/* Traffic impact panel */}
        <div className="border border-border/40 rounded-md p-2.5 space-y-2 bg-muted/10">
          <p className="text-[9px] font-semibold tracking-widest text-muted-foreground/60 uppercase">Traffic Impact</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Speed factor</span>
              <span className={cn("text-[11px] font-mono font-semibold", getSpeedImpactColor(weather.speed_factor))}>
                {speedPct}%
                {weather.speed_factor < 0.98 && <span className="text-muted-foreground ml-1 font-normal">(-{100 - speedPct}%)</span>}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Density impact</span>
              <span className={cn("text-[11px] font-mono font-semibold", densityPct > 0 ? "text-orange-400" : "text-green-400")}>
                {densityPct > 0 ? `+${densityPct}%` : "None"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Green extension</span>
              <span className={cn("text-[11px] font-mono font-semibold", getGreenExtColor(weather.green_extension_sec))}>
                {weather.green_extension_sec > 0 ? `+${weather.green_extension_sec}s` : "None"}
              </span>
            </div>
          </div>
          {isAffecting && (
            <div className={cn(
              "mt-2 pt-2 border-t border-border/30 text-[9px] leading-relaxed",
              weather.severe ? "text-orange-400/80" : "text-yellow-400/80"
            )}>
              {weather.severe ? "⚠️ Severe conditions — extended cycles active" : "ℹ️ Reduced speed limits and extended green phases applied"}
            </div>
          )}
        </div>

        {/* Last updated */}
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/40">
          <Clock className="w-3 h-3" />
          Updated {formatDistanceToNow(new Date(weather.last_fetched), { addSuffix: true })}
        </div>
      </CardContent>
    </Card>
  );
}
