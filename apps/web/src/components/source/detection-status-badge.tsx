import { useTrafficStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Presentational badge reflecting the active video detection status.
 *
 * Reads `dataSource` from the traffic store (populated from the WS
 * `data_source` field). The badge is only meaningful while in video mode,
 * so it renders nothing in simulation mode or before any data_source has
 * been received.
 */
export function DetectionStatusBadge() {
  const dataSource = useTrafficStore((s) => s.dataSource);

  // Only meaningful in video mode.
  if (!dataSource || dataSource.mode !== "video") return null;

  const { detection, fallback_active } = dataSource;

  let label: string;
  let className: string;

  if (fallback_active) {
    label = "Video • Fallback (simulation)";
    className = "border-amber-500/40 bg-amber-500/10 text-amber-300";
  } else if (detection === "unavailable") {
    label = "Video • Detector unavailable";
    className = "border-red-500/40 bg-red-500/10 text-red-300";
  } else if (detection === "ready") {
    label = "Video • Ready";
    className = "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  } else if (detection === "degraded") {
    label = "Video • Degraded";
    className = "border-amber-500/40 bg-amber-500/10 text-amber-300";
  } else {
    // initializing
    label = "Video • Initializing";
    className = "border-border/40 bg-muted/20 text-muted-foreground";
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full font-mono text-[10px] transition-colors duration-300",
        className
      )}
    >
      {label}
    </Badge>
  );
}
