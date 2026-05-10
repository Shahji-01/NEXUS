/**
 * NetworkFlowMap — animated SVG multi-junction corridor
 * Shows 5 junction nodes connected by bidirectional road lanes with
 * particle flow proportional to avg_speed and congestion colour.
 */

interface JunctionNode {
  id: number;
  name: string;
  distance_m: number;
  density: number;
  avg_speed: number;
  congestion_level: string;
  current_phase: "green" | "yellow" | "red";
  green_offset_s: number;
  vehicles_queued: number;
  throughput_pct: number;
  delay_s: number;
}

const CONGESTION_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};
const PHASE_COLOR: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

const W = 760, H = 220;
const MARGIN_X = 70;
const CY = 108;
const NB_Y = CY - 14;
const SB_Y = CY + 14;
const ROAD_H = 11;
const R_NODE = 22;
const TOTAL_DIST = 1850;
const SCALE = (W - 2 * MARGIN_X) / TOTAL_DIST;

function jX(distM: number) { return MARGIN_X + distM * SCALE; }
function cong(level: string) { return CONGESTION_COLOR[level] ?? "#22c55e"; }
function phase(p: string) { return PHASE_COLOR[p] ?? "#ef4444"; }
function particleDur(speed: number) { return Math.max(2.2, 13 - speed / 7); }

export function NetworkFlowMap({ junctions }: { junctions: JunctionNode[] }) {
  if (junctions.length === 0) {
    return <div className="flex items-center justify-center h-[220px] text-muted-foreground text-xs">Loading network…</div>;
  }

  const segments = junctions.slice(0, -1).map((j, i) => ({
    j0: j,
    j1: junctions[i + 1]!,
    x1: jX(j.distance_m),
    x2: jX(junctions[i + 1]!.distance_m),
    idx: i,
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" style={{ height: H }}>
        {/* ── defs ── */}
        <defs>
          {segments.map(({ j0, j1, x1, x2, idx }) => (
            <g key={idx}>
              <path id={`p-nb-${idx}`} d={`M ${x1 + R_NODE + 3},${NB_Y} L ${x2 - R_NODE - 3},${NB_Y}`} />
              <path id={`p-sb-${idx}`} d={`M ${x2 - R_NODE - 3},${SB_Y} L ${x1 + R_NODE + 3},${SB_Y}`} />
            </g>
          ))}
        </defs>

        {/* ── road segments ── */}
        {segments.map(({ j0, j1, x1, x2, idx }) => {
          const segW = x2 - x1 - 2 * R_NODE;
          const segX = x1 + R_NODE;
          const nb_color = cong(j0.congestion_level);
          const sb_color = cong(j1.congestion_level);

          return (
            <g key={idx}>
              {/* NB road track */}
              <rect x={segX} y={NB_Y - ROAD_H / 2} width={segW} height={ROAD_H} fill="#1e293b" rx={3} />
              <rect x={segX} y={NB_Y - ROAD_H / 2} width={segW} height={ROAD_H} fill={nb_color} opacity={0.18} rx={3} />
              {/* SB road track */}
              <rect x={segX} y={SB_Y - ROAD_H / 2} width={segW} height={ROAD_H} fill="#1e293b" rx={3} />
              <rect x={segX} y={SB_Y - ROAD_H / 2} width={segW} height={ROAD_H} fill={sb_color} opacity={0.18} rx={3} />
              {/* centre divider */}
              <rect x={segX} y={CY - 1} width={segW} height={2} fill="#1e293b" opacity={0.8} />

              {/* NB particles (→) */}
              {[0, 1, 2, 3].map(pi => {
                const dur = particleDur(j0.avg_speed);
                return (
                  <circle key={pi} r={2.8} fill={nb_color} opacity={0.9}>
                    <animateMotion dur={`${dur.toFixed(2)}s`} repeatCount="indefinite" begin={`${(pi * dur / 4).toFixed(2)}s`}>
                      <mpath href={`#p-nb-${idx}`} />
                    </animateMotion>
                  </circle>
                );
              })}

              {/* SB particles (←) */}
              {[0, 1, 2, 3].map(pi => {
                const dur = particleDur(j1.avg_speed);
                return (
                  <circle key={pi} r={2.8} fill={sb_color} opacity={0.9}>
                    <animateMotion dur={`${dur.toFixed(2)}s`} repeatCount="indefinite" begin={`${(pi * dur / 4).toFixed(2)}s`}>
                      <mpath href={`#p-sb-${idx}`} />
                    </animateMotion>
                  </circle>
                );
              })}
            </g>
          );
        })}

        {/* ── junction nodes ── */}
        {junctions.map(j => {
          const x = jX(j.distance_m);
          const pc = phase(j.current_phase);
          const cc = cong(j.congestion_level);
          const isGreen = j.current_phase === "green";

          return (
            <g key={j.id}>
              {/* outer glow */}
              <circle cx={x} cy={CY} r={R_NODE + 9} fill={pc} opacity={0.07} />
              {/* ring pulse when green */}
              {isGreen && (
                <circle cx={x} cy={CY} r={R_NODE + 5} fill="none" stroke={pc} strokeWidth={1.5} opacity={0.4}>
                  <animate attributeName="r" values={`${R_NODE + 3};${R_NODE + 12};${R_NODE + 3}`} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* main node circle */}
              <circle cx={x} cy={CY} r={R_NODE} fill="hsl(var(--card))" stroke={pc} strokeWidth={2.5} style={{ filter: `drop-shadow(0 0 6px ${pc}55)` }} />

              {/* phase dot */}
              <circle cx={x} cy={CY - 10} r={4} fill={pc} opacity={0.9} />

              {/* density */}
              <text x={x} y={CY + 6} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight="bold" fill={cc}>
                {j.density.toFixed(0)}%
              </text>

              {/* speed label above */}
              <text x={x} y={CY - R_NODE - 18} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="hsl(var(--muted-foreground))">
                {j.avg_speed.toFixed(0)} km/h
              </text>

              {/* queued count badge */}
              {j.vehicles_queued > 0 && (
                <g>
                  <rect x={x + R_NODE - 2} y={CY - R_NODE - 2} width={16} height={11} rx={5} fill={cc} opacity={0.85} />
                  <text x={x + R_NODE + 6} y={CY - R_NODE + 6.5} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="#000" fontWeight="bold">
                    {j.vehicles_queued}q
                  </text>
                </g>
              )}

              {/* name below */}
              <text x={x} y={CY + R_NODE + 14} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="hsl(var(--foreground))" opacity={0.7}>
                {j.name.length > 9 ? j.name.slice(0, 9) : j.name}
              </text>

              {/* offset badge */}
              <text x={x} y={CY + R_NODE + 24} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="hsl(var(--muted-foreground))">
                +{j.green_offset_s}s
              </text>
            </g>
          );
        })}

        {/* ── lane direction labels ── */}
        <text x={8} y={NB_Y + 3} fontSize={8} fontFamily="monospace" fill="hsl(var(--muted-foreground))">NB →</text>
        <text x={8} y={SB_Y + 3} fontSize={8} fontFamily="monospace" fill="hsl(var(--muted-foreground))">← SB</text>

        {/* ── congestion legend ── */}
        {[["Low", "#22c55e"], ["Med", "#eab308"], ["High", "#f97316"], ["Crit", "#ef4444"]].map(([lbl, col], i) => (
          <g key={lbl} transform={`translate(${W - 52}, ${H - 46 + i * 11})`}>
            <rect width={8} height={8} fill={col} rx={2} opacity={0.8} />
            <text x={11} y={7} fontSize={7} fontFamily="monospace" fill="hsl(var(--muted-foreground))">{lbl}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── NetworkScore gauge ── */
function toRad(deg: number) { return deg * Math.PI / 180; }

export function NetworkScore({ score }: { score: number }) {
  const r = 44, cx = 64, cy = 68;
  const startDeg = 135;
  const totalDeg = 270;
  const scoreDeg = startDeg + (score / 100) * totalDeg;

  const sx = cx + r * Math.cos(toRad(startDeg));
  const sy = cy + r * Math.sin(toRad(startDeg));
  const ex = cx + r * Math.cos(toRad(135 + totalDeg));  // 45°
  const ey = cy + r * Math.sin(toRad(135 + totalDeg));

  const sfx = cx + r * Math.cos(toRad(scoreDeg));
  const sfy = cy + r * Math.sin(toRad(scoreDeg));
  const largeArc = (score / 100) * totalDeg > 180 ? 1 : 0;

  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  const label = score >= 80 ? "OPTIMAL" : score >= 60 ? "GOOD" : score >= 40 ? "MODERATE" : "CRITICAL";

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Network Score</p>
      <svg viewBox="0 0 128 110" width={128} height={110}>
        {/* track */}
        <path
          d={`M ${sx.toFixed(1)},${sy.toFixed(1)} A ${r} ${r} 0 1 1 ${ex.toFixed(1)},${ey.toFixed(1)}`}
          fill="none" stroke="hsl(var(--border))" strokeWidth={9} strokeLinecap="round"
        />
        {/* score arc */}
        {score > 2 && (
          <path
            d={`M ${sx.toFixed(1)},${sy.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${sfx.toFixed(1)},${sfy.toFixed(1)}`}
            fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 5px ${color}88)` }}
          />
        )}
        {/* score text */}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={26} fontWeight="bold" fontFamily="monospace" fill="white">{score}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="hsl(var(--muted-foreground))">/100</text>
      </svg>
      <span className="text-[10px] font-bold tracking-widest" style={{ color }}>{label}</span>
    </div>
  );
}
