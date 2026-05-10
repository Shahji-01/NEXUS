import { motion } from "framer-motion";
import { useTrafficStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function densityToStyle(density: number): { fill: string; glow: string; label: string } {
  if (density >= 80) return { fill: "#dc2626", glow: "#dc262650", label: "Critical" };
  if (density >= 55) return { fill: "#ea580c", glow: "#ea580c50", label: "High" };
  if (density >= 30) return { fill: "#ca8a04", glow: "#ca8a0450", label: "Medium" };
  return { fill: "#16a34a", glow: "#16a34a50", label: "Low" };
}

const LEGEND = [
  { color: "#16a34a", label: "Low <30%" },
  { color: "#ca8a04", label: "Med 30%" },
  { color: "#ea580c", label: "High 55%" },
  { color: "#dc2626", label: "Crit 80%" },
];

export function CongestionHeatmap() {
  const { lanes } = useTrafficStore();

  const arms = [
    { id: 0, label: "N", x: 155, y: 30,  w: 90, h: 110, cx: 200, cy: 80,  lx: 200, ly: 24  },
    { id: 1, label: "S", x: 155, y: 260, w: 90, h: 110, cx: 200, cy: 315, lx: 200, ly: 383 },
    { id: 2, label: "E", x: 260, y: 155, w: 110, h: 90, cx: 315, cy: 200, lx: 384, ly: 200 },
    { id: 3, label: "W", x: 30,  y: 155, w: 110, h: 90, cx: 75,  cy: 200, lx: 16,  ly: 200 },
  ] as const;

  return (
    <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Junction Heatmap</p>
        <div className="flex items-center gap-3">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
              <span className="text-[9px] text-muted-foreground">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 400 400" className="w-full max-h-64 mx-auto" aria-label="Junction congestion heatmap">
        {/* Intersection box */}
        <rect x="140" y="140" width="120" height="120" rx="10" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
        <text x="200" y="195" textAnchor="middle" fill="#4b5563" fontSize="10" fontFamily="monospace">NEXUS</text>
        <text x="200" y="210" textAnchor="middle" fill="#374151" fontSize="9" fontFamily="sans-serif">JUNCTION</text>

        {/* Road connectors */}
        <rect x="185" y="130" width="30" height="16" fill="#111827" />
        <rect x="185" y="254" width="30" height="16" fill="#111827" />
        <rect x="130" y="185" width="16" height="30" fill="#111827" />
        <rect x="254" y="185" width="16" height="30" fill="#111827" />

        {arms.map(({ id, label, x, y, w, h, cx, cy, lx, ly }) => {
          const lane = lanes[id];
          const density = lane?.density ?? 0;
          const { fill, glow, label: congLabel } = densityToStyle(density);
          const isHot = density >= 55;

          return (
            <g key={id}>
              {/* Glow halo */}
              <motion.rect
                x={x - 5} y={y - 5} width={w + 10} height={h + 10}
                rx="12" fill={glow}
                animate={{ opacity: isHot ? [0.3, 0.7, 0.3] : 0.2 }}
                transition={{ repeat: Infinity, duration: isHot ? 1.2 : 3 }}
              />
              {/* Arm block */}
              <motion.rect
                x={x} y={y} width={w} height={h}
                rx="8" fill={fill}
                animate={{ opacity: [0.78, 0.95, 0.78] }}
                transition={{ repeat: Infinity, duration: 2.5, delay: id * 0.35 }}
              />
              {/* Density % */}
              <text x={cx} y={cy - 7} textAnchor="middle" fill="white" fontSize="15"
                fontWeight="700" fontFamily="monospace">
                {density.toFixed(0)}%
              </text>
              {/* Vehicle count */}
              <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="10"
                fontFamily="sans-serif">
                {lane?.vehicle_count ?? 0} veh
              </text>
              {/* Congestion label */}
              <text x={cx} y={cy + 24} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8"
                fontFamily="sans-serif" letterSpacing="1">
                {congLabel.toUpperCase()}
              </text>
              {/* Direction label */}
              <text x={lx} y={ly} textAnchor="middle" fill="#6b7280" fontSize="11" fontFamily="sans-serif"
                fontWeight="600">
                {label}
              </text>
            </g>
          );
        })}

        {/* Center crosshairs */}
        <line x1="140" y1="200" x2="260" y2="200" stroke="#374151" strokeWidth="0.5" strokeDasharray="4 3" />
        <line x1="200" y1="140" x2="200" y2="260" stroke="#374151" strokeWidth="0.5" strokeDasharray="4 3" />
        <circle cx="200" cy="200" r="4" fill="#4b5563" />
      </svg>
    </div>
  );
}
