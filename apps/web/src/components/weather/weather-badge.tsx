import { useTrafficStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function WeatherBadge() {
  const { weather } = useTrafficStore();

  if (!weather) return null;

  const isAffecting = weather.speed_factor < 0.98 || weather.green_extension_sec > 0;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all duration-300",
      weather.severe
        ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
        : isAffecting
        ? "border-yellow-500/30 bg-yellow-500/8 text-yellow-300"
        : "border-border/40 bg-muted/20 text-muted-foreground"
    )}>
      <span role="img" aria-label={weather.label} className="text-base leading-none">
        {weather.icon}
      </span>
      <span className="hidden sm:inline">{weather.label} · Delhi</span>
      <span className="text-[10px] font-mono">{weather.temperature_c}°C</span>
      {isAffecting && (
        <span className={cn(
          "text-[9px] border px-1 py-0.5 rounded font-mono",
          weather.severe ? "border-orange-500/50 text-orange-400" : "border-yellow-500/40 text-yellow-400"
        )}>
          +{weather.green_extension_sec}s
        </span>
      )}
    </div>
  );
}
