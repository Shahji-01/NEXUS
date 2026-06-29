import { useEffect, useState } from "react";
import { VideoOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useTrafficStore } from "@/lib/store";
import { API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

const LANE_LABELS: Record<number, string> = {
  0: "North Bound",
  1: "South Bound",
  2: "East Bound",
  3: "West Bound",
};

interface LaneVideoOverlayProps {
  laneId: number;
}

const congestionTextColor = (level?: string) => {
  switch (level) {
    case "critical":
      return "text-red-500 border-red-500/20";
    case "high":
      return "text-orange-500 border-orange-500/20";
    case "medium":
      return "text-yellow-500 border-yellow-500/20";
    case "low":
      return "text-green-500 border-green-500/20";
    default:
      return "text-muted-foreground border-border/40";
  }
};

export function LaneVideoOverlay({ laneId }: LaneVideoOverlayProps) {
  const lane = useTrafficStore((state) => state.lanes[laneId]);
  const [errored, setErrored] = useState(false);

  // Reset the error flag whenever the lane changes so a previously failed
  // lane can recover when re-pointed at a different stream.
  useEffect(() => {
    setErrored(false);
  }, [laneId]);

  const name = LANE_LABELS[laneId] ?? `Lane ${laneId}`;
  const streamUrl = `${API_URL}/detection/lanes/${laneId}/stream`;

  return (
    <Card className="relative aspect-video overflow-hidden border-border/50 bg-black/60">
      {errored ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/20 text-muted-foreground">
          <VideoOff className="h-6 w-6" />
          <span className="text-xs font-mono uppercase tracking-wider">Overlay unavailable</span>
        </div>
      ) : (
        <img
          src={streamUrl}
          alt={`${name} detection overlay`}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      )}

      {/* Lane name + congestion (top) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2">
        <h3 className="font-mono text-xs font-semibold tracking-wider text-white drop-shadow">
          {name}
        </h3>
        <span
          className={cn(
            "rounded-sm border bg-background/70 px-2 py-0.5 text-[10px] font-bold uppercase backdrop-blur",
            congestionTextColor(lane?.congestion_level)
          )}
        >
          {lane?.congestion_level ?? "--"}
        </span>
      </div>

      {/* Live vehicle count (bottom) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-xl font-light leading-none text-white drop-shadow">
            {lane?.vehicle_count ?? 0}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-white/70">vehicles</span>
        </div>
      </div>
    </Card>
  );
}
