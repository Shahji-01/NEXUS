import { useTrafficStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const LANE_NAMES = ["N", "S", "E", "W"];
const COLORS = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

function densityToOpacity(density: number) {
  return Math.max(0.15, Math.min(0.85, density / 100));
}

interface ArrowProps {
  d: string;
  color: string;
  opacity: number;
  phase: string;
}

function RoadArrow({ d, color, opacity, phase }: ArrowProps) {
  const isGreen = phase === "green";
  return (
    <motion.path
      d={d}
      fill={color}
      opacity={isGreen ? opacity : opacity * 0.5}
      animate={{ opacity: isGreen ? [opacity, opacity * 0.6, opacity] : opacity * 0.4 }}
      transition={isGreen ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
    />
  );
}

export function JunctionMap() {
  const { lanes, signals } = useTrafficStore();

  const getLane = (id: number) => lanes[id] ?? { density: 0, vehicle_count: 0, congestion_level: "low" as const };
  const getPhase = (id: number): string => signals?.phases?.[id] ?? "red";

  const north = getLane(0);
  const south = getLane(1);
  const east = getLane(2);
  const west = getLane(3);

  const northColor = COLORS[north.congestion_level as keyof typeof COLORS] ?? COLORS.low;
  const southColor = COLORS[south.congestion_level as keyof typeof COLORS] ?? COLORS.low;
  const eastColor = COLORS[east.congestion_level as keyof typeof COLORS] ?? COLORS.low;
  const westColor = COLORS[west.congestion_level as keyof typeof COLORS] ?? COLORS.low;

  const cx = 160; // center x
  const cy = 160; // center y
  const int = 35; // intersection half-size
  const roadW = 28; // road half-width

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 320 320" className="w-full h-full max-w-[320px] max-h-[320px]">
        {/* Background */}
        <rect width="320" height="320" fill="hsl(var(--background))" rx="8" />

        {/* Road surfaces */}
        {/* Vertical road */}
        <rect x={cx - roadW} y="0" width={roadW * 2} height="320" fill="#1e293b" />
        {/* Horizontal road */}
        <rect x="0" y={cy - roadW} width="320" height={roadW * 2} fill="#1e293b" />

        {/* Intersection box */}
        <rect x={cx - int} y={cy - int} width={int * 2} height={int * 2} fill="#1e293b" />

        {/* Road markings — dashed center lines */}
        {/* Vertical dashes */}
        {[30, 70, 230, 270].map((y) => (
          <rect key={`vd${y}`} x={cx - 1} y={y} width={2} height={16} fill="#374151" opacity={0.8} />
        ))}
        {/* Horizontal dashes */}
        {[30, 70, 230, 270].map((x) => (
          <rect key={`hd${x}`} x={x} y={cy - 1} width={16} height={2} fill="#374151" opacity={0.8} />
        ))}

        {/* Zebra crossings */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={`zn${i}`} x={cx - roadW} y={cy - int - 10 + i * 3} width={roadW * 2} height={1.5} fill="#374151" opacity={0.6} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={`zs${i}`} x={cx - roadW} y={cy + int + 4 + i * 3} width={roadW * 2} height={1.5} fill="#374151" opacity={0.6} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={`ze${i}`} x={cx + int + 4 + i * 3} y={cy - roadW} width={1.5} height={roadW * 2} fill="#374151" opacity={0.6} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={`zw${i}`} x={cx - int - 10 + i * 3} y={cy - roadW} width={1.5} height={roadW * 2} fill="#374151" opacity={0.6} />
        ))}

        {/* Traffic flow arrows — density heatmap layer */}
        {/* North inbound (top → intersection): triangle pointing down */}
        <RoadArrow
          d={`M${cx - 10},${cy - int - 20} L${cx + 10},${cy - int - 20} L${cx},${cy - int - 5} Z`}
          color={northColor}
          opacity={densityToOpacity(north.density)}
          phase={getPhase(0)}
        />
        {/* South inbound (bottom → intersection): triangle pointing up */}
        <RoadArrow
          d={`M${cx - 10},${cy + int + 20} L${cx + 10},${cy + int + 20} L${cx},${cy + int + 5} Z`}
          color={southColor}
          opacity={densityToOpacity(south.density)}
          phase={getPhase(1)}
        />
        {/* East inbound (right → intersection): triangle pointing left */}
        <RoadArrow
          d={`M${cx + int + 20},${cy - 10} L${cx + int + 20},${cy + 10} L${cx + int + 5},${cy} Z`}
          color={eastColor}
          opacity={densityToOpacity(east.density)}
          phase={getPhase(2)}
        />
        {/* West inbound (left → intersection): triangle pointing right */}
        <RoadArrow
          d={`M${cx - int - 20},${cy - 10} L${cx - int - 20},${cy + 10} L${cx - int - 5},${cy} Z`}
          color={westColor}
          opacity={densityToOpacity(west.density)}
          phase={getPhase(3)}
        />

        {/* Signal dots at each road entrance */}
        {/* North signal */}
        <SignalDot cx={cx + roadW - 8} cy={cy - int - 4} phase={getPhase(0)} emergency={signals?.emergency_lane === 0} />
        {/* South signal */}
        <SignalDot cx={cx - roadW + 8} cy={cy + int + 4} phase={getPhase(1)} emergency={signals?.emergency_lane === 1} />
        {/* East signal */}
        <SignalDot cx={cx + int + 4} cy={cy - roadW + 8} phase={getPhase(2)} emergency={signals?.emergency_lane === 2} />
        {/* West signal */}
        <SignalDot cx={cx - int - 4} cy={cy + roadW - 8} phase={getPhase(3)} emergency={signals?.emergency_lane === 3} />

        {/* Density fill overlays on road segments */}
        <rect x={cx - roadW + 2} y={4} width={roadW * 2 - 4} height={cy - int - 8} fill={northColor} opacity={densityToOpacity(north.density) * 0.25} rx={2} />
        <rect x={cx - roadW + 2} y={cy + int + 4} width={roadW * 2 - 4} height={cy - int - 8} fill={southColor} opacity={densityToOpacity(south.density) * 0.25} rx={2} />
        <rect x={cy + int + 4} y={cy - roadW + 2} width={cx - int - 8} height={roadW * 2 - 4} fill={eastColor} opacity={densityToOpacity(east.density) * 0.25} rx={2} />
        <rect x={4} y={cy - roadW + 2} width={cx - int - 8} height={roadW * 2 - 4} fill={westColor} opacity={densityToOpacity(west.density) * 0.25} rx={2} />

        {/* Lane labels */}
        <text x={cx} y={14} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">N BOUND</text>
        <text x={cx} y={312} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">S BOUND</text>
        <text x={308} y={cy + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">E</text>
        <text x={12} y={cy + 4} textAnchor="start" fill="#94a3b8" fontSize="10" fontFamily="monospace">W</text>

        {/* Vehicle count labels on each road */}
        <text x={cx + roadW + 6} y={cy - int / 2} fill={northColor} fontSize="9" fontFamily="monospace">{north.vehicle_count}v</text>
        <text x={cx + roadW + 6} y={cy + int / 2} fill={southColor} fontSize="9" fontFamily="monospace">{south.vehicle_count}v</text>
        <text x={cx + int / 2 - 4} y={cy - roadW - 4} fill={eastColor} fontSize="9" fontFamily="monospace" textAnchor="middle">{east.vehicle_count}v</text>
        <text x={cx - int / 2 + 4} y={cy + roadW + 12} fill={westColor} fontSize="9" fontFamily="monospace" textAnchor="middle">{west.vehicle_count}v</text>

        {/* Center intersection indicator */}
        {signals?.emergency_active ? (
          <EmergencyPulse cx={cx} cy={cy} />
        ) : (
          <circle cx={cx} cy={cy} r={6} fill="hsl(var(--primary))" opacity={0.6} />
        )}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        {[
          { label: "Low", color: COLORS.low },
          { label: "Med", color: COLORS.medium },
          { label: "High", color: COLORS.high },
          { label: "Crit", color: COLORS.critical },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-[9px] text-muted-foreground font-mono">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalDot({ cx, cy, phase, emergency }: { cx: number; cy: number; phase: string; emergency?: boolean | null }) {
  const color = emergency ? "#ef4444" : phase === "green" ? "#22c55e" : phase === "yellow" ? "#eab308" : "#ef4444";
  const active = phase === "green" || !!emergency;
  return (
    <g>
      {active && (
        <>
          <circle cx={cx} cy={cy} r={8} fill={color} opacity={0}>
            <animate attributeName="r" values="5;11;5" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;0;0.6" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      <circle cx={cx} cy={cy} r={5} fill={color} style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </g>
  );
}

function EmergencyPulse({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={10} fill="none" stroke="#ef4444" strokeWidth={2} opacity={0.8}>
        <animate attributeName="r" values="8;22;8" dur="1s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;0;0.8" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={6} fill="#ef4444" opacity={0.95} />
    </>
  );
}
