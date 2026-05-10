import { Shell } from "@/components/layout/shell";
import {
  useGetTrafficHistory, getGetTrafficHistoryQueryKey,
  useGetTrafficSummary, getGetTrafficSummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LineChart, Line, Legend, PieChart, Pie, Cell,
  AreaChart, Area,
} from "recharts";
import { useState, useEffect, useCallback, useRef } from "react";
import { format } from "date-fns";
import { Download, TrendingUp, TrendingDown, Activity, Gauge, RefreshCw } from "lucide-react";

const LANE_NAMES = ["All Lanes", "North Bound", "South Bound", "East Bound", "West Bound"];
const LANE_COLORS = ["#3b82f6", "#22d3ee", "#a78bfa", "#f97316"];
const LANE_KEYS = ["north", "south", "east", "west"];

interface HourlyRow { hour: number; label: string; avg_density: number; avg_vehicles: number; avg_speed: number; }
interface CongDist { level: string; count: number; color: string; }

function useHourlyData(laneId: number | null, refreshKey: number) {
  const [data, setData] = useState<HourlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const params = laneId !== null ? `?lane_id=${laneId}` : "";
    fetch(`/api/analytics/hourly${params}`)
      .then(r => r.json())
      .then(d => { setData(d.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [laneId, refreshKey]);
  return { data, loading };
}

function useCongestionDist(laneId: number | null, refreshKey: number) {
  const [data, setData] = useState<CongDist[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const params = laneId !== null ? `?lane_id=${laneId}` : "";
    fetch(`/api/analytics/congestion-distribution${params}`)
      .then(r => r.json())
      .then(d => { setData(d.distribution ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [laneId, refreshKey]);
  return { data, loading };
}

const tooltipStyle = {
  contentStyle: { backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' },
  itemStyle: { color: 'hsl(var(--foreground))' },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
};

function StatCard({
  label, value, sub, icon: Icon, trend, loading,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType;
  trend?: "up" | "down" | null; loading?: boolean;
}) {
  return (
    <Card className="bg-card/40 backdrop-blur border-border/50">
      <CardContent className="p-4">
        {loading ? <Skeleton className="h-12 w-full" /> : (
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
              {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              {trend && (
                <div className={trend === "up" ? "text-red-400" : "text-green-400"}>
                  {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Analytics() {
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const histParams = { lane_id: selectedLane ?? undefined, limit: 200 };
  const { data: history, isLoading: histLoading, refetch: refetchHistory } = useGetTrafficHistory(
    histParams,
    { query: { queryKey: getGetTrafficHistoryQueryKey(histParams) } }
  );

  const { data: summary, refetch: refetchSummary } = useGetTrafficSummary(
    { query: { queryKey: getGetTrafficSummaryQueryKey() } }
  );

  const h0Params = { lane_id: 0, limit: 200 };
  const h1Params = { lane_id: 1, limit: 200 };
  const h2Params = { lane_id: 2, limit: 200 };
  const h3Params = { lane_id: 3, limit: 200 };
  const { data: hist0, refetch: refetchH0 } = useGetTrafficHistory(h0Params, { query: { queryKey: getGetTrafficHistoryQueryKey(h0Params), enabled: selectedLane === null } });
  const { data: hist1, refetch: refetchH1 } = useGetTrafficHistory(h1Params, { query: { queryKey: getGetTrafficHistoryQueryKey(h1Params), enabled: selectedLane === null } });
  const { data: hist2, refetch: refetchH2 } = useGetTrafficHistory(h2Params, { query: { queryKey: getGetTrafficHistoryQueryKey(h2Params), enabled: selectedLane === null } });
  const { data: hist3, refetch: refetchH3 } = useGetTrafficHistory(h3Params, { query: { queryKey: getGetTrafficHistoryQueryKey(h3Params), enabled: selectedLane === null } });

  const { data: hourly, loading: hourlyLoading } = useHourlyData(selectedLane, refreshKey);
  const { data: congDist, loading: congLoading } = useCongestionDist(selectedLane, refreshKey);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchHistory(),
      refetchSummary(),
      ...(selectedLane === null ? [refetchH0(), refetchH1(), refetchH2(), refetchH3()] : []),
    ]);
    setRefreshKey(k => k + 1);
    setIsRefreshing(false);
  }, [refetchHistory, refetchSummary, refetchH0, refetchH1, refetchH2, refetchH3, selectedLane]);

  const timelineData = history?.items?.slice().reverse().map(item => ({
    time: format(new Date(item.timestamp), "HH:mm"),
    density: Math.round((item.density ?? 0) * 10) / 10,
    vehicles: item.vehicle_count ?? 0,
    speed: Math.round((item.avg_speed ?? 0) * 10) / 10,
    congestion: item.congestion_level,
  })) ?? [];

  const multiLaneData = (() => {
    if (selectedLane !== null) return [];
    const allHistories = [hist0, hist1, hist2, hist3];
    const byTime: Record<string, Record<string, number>> = {};
    allHistories.forEach((h, laneIdx) => {
      h?.items?.slice().reverse().forEach(item => {
        const t = format(new Date(item.timestamp), "HH:mm");
        if (!byTime[t]) byTime[t] = { time_sort: new Date(item.timestamp).getTime() };
        byTime[t][LANE_KEYS[laneIdx]] = Math.round((item.density ?? 0) * 10) / 10;
      });
    });
    return Object.entries(byTime)
      .sort(([, a], [, b]) => (a.time_sort as number) - (b.time_sort as number))
      .map(([time, vals]) => ({ time, ...vals }));
  })();

  const totalCong = congDist.reduce((s, d) => s + d.count, 0);

  const avgDensity = timelineData.length
    ? Math.round(timelineData.reduce((s, r) => s + r.density, 0) / timelineData.length * 10) / 10
    : 0;

  const avgSpeed = timelineData.length
    ? Math.round(timelineData.filter(r => r.speed > 0).reduce((s, r) => s + r.speed, 0) /
      Math.max(1, timelineData.filter(r => r.speed > 0).length) * 10) / 10
    : 0;

  const peakHourRow = hourly.length ? [...hourly].sort((a, b) => b.avg_density - a.avg_density)[0] : null;
  const totalReadings = history?.total ?? 0;

  const handleExportCSV = useCallback(() => {
    if (!history?.items?.length) return;
    const laneLabel = selectedLane !== null ? LANE_NAMES[selectedLane + 1] : "All Lanes";
    const header = "timestamp,lane_id,density,vehicle_count,avg_speed,congestion_level,cars,bikes,trucks,buses";
    const rows = history.items.map(r =>
      [r.timestamp, r.lane_id, r.density, r.vehicle_count, r.avg_speed ?? "",
       r.congestion_level, r.cars ?? 0, r.bikes ?? 0, r.trucks ?? 0, r.buses ?? 0].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-traffic-${laneLabel.replace(/\s+/g, "-").toLowerCase()}-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [history, selectedLane]);

  const showMultiLane = selectedLane === null && multiLaneData.length > 0;

  return (
    <Shell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Analytics & Trends</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalReadings > 0 ? `${totalReadings.toLocaleString()} historical readings` : "24-hour historical traffic analysis"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {[null, 0, 1, 2, 3].map((lane) => (
                <Button
                  key={lane ?? "all"}
                  variant={selectedLane === lane ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedLane(lane)}
                  className="whitespace-nowrap text-xs h-8 px-3"
                >
                  {lane !== null && (
                    <span
                      className="w-1.5 h-1.5 rounded-full mr-1.5 inline-block"
                      style={{ backgroundColor: LANE_COLORS[lane] }}
                    />
                  )}
                  {LANE_NAMES[lane === null ? 0 : lane + 1]}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-xs h-8 px-3 gap-1.5 border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={!history?.items?.length}
              className="text-xs h-8 px-3 gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Readings"
            value={totalReadings.toLocaleString()}
            sub={`last ${timelineData.length} shown`}
            icon={Activity}
            loading={histLoading}
          />
          <StatCard
            label="Avg Density"
            value={`${avgDensity}%`}
            sub={selectedLane !== null ? LANE_NAMES[selectedLane + 1] : "all lanes"}
            icon={Gauge}
            trend={avgDensity > 40 ? "up" : avgDensity < 20 ? "down" : null}
            loading={histLoading}
          />
          <StatCard
            label="Peak Hour"
            value={peakHourRow ? peakHourRow.label : (summary?.peak_hour !== undefined ? `${summary.peak_hour}:00` : "—")}
            sub={peakHourRow ? `${peakHourRow.avg_density}% avg density` : "busiest hour"}
            icon={TrendingUp}
            loading={hourlyLoading}
          />
          <StatCard
            label="Avg Speed"
            value={avgSpeed > 0 ? `${avgSpeed} km/h` : "—"}
            sub="across selected data"
            icon={Activity}
            trend={avgSpeed > 0 && avgSpeed < 35 ? "up" : null}
            loading={histLoading}
          />
        </div>

        {/* Density timeline */}
        <Card className="bg-card/40 backdrop-blur border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">
              {showMultiLane ? "MULTI-LANE DENSITY COMPARISON" : "DENSITY TIMELINE"}
            </CardTitle>
            {showMultiLane && (
              <div className="flex gap-3">
                {LANE_KEYS.map((key, i) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: LANE_COLORS[i] }} />
                    <span className="text-[9px] text-muted-foreground font-mono uppercase">{["N", "S", "E", "W"][i]}</span>
                  </div>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="h-[260px]">
            {histLoading ? <Skeleton className="w-full h-full" /> : showMultiLane ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={multiLaneData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    {LANE_KEYS.map((key, i) => (
                      <linearGradient key={key} id={`grad${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={LANE_COLORS[i]} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={LANE_COLORS[i]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickMargin={8} minTickGap={40} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={v => `${v}%`} width={36} />
                  <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [`${v}%`, `${name.charAt(0).toUpperCase() + name.slice(1)} Bound`]} />
                  {LANE_KEYS.map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={LANE_COLORS[i]}
                      strokeWidth={1.5}
                      fill={`url(#grad${i})`}
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickMargin={8} minTickGap={40} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={v => `${v}%`} width={36} />
                  <Tooltip {...tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="density" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Density %" />
                  <Line type="monotone" dataKey="speed" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="Speed km/h" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Row 2: Rush hour + Vehicle volume */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">RUSH HOUR PROFILE (AVG DENSITY BY HOUR)</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              {hourlyLoading ? <Skeleton className="w-full h-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={9} tickMargin={6} minTickGap={10} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={v => `${v}%`} width={34} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(val: number, name: string) => {
                        if (name === "avg_density") return [`${val}%`, "Avg Density"];
                        return [val, name];
                      }}
                    />
                    <Bar dataKey="avg_density" fill="url(#barGrad)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">VEHICLE VOLUME (LAST 40 READINGS)</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              {histLoading ? <Skeleton className="w-full h-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData.slice(-40)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={28} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} />
                    <Bar dataKey="vehicles" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Vehicles" maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Congestion distribution + Speed trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">CONGESTION DISTRIBUTION</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              {congLoading ? <Skeleton className="w-full h-full" /> : (
                <div className="flex items-center gap-6 h-full">
                  <ResponsiveContainer width="55%" height="100%">
                    <PieChart>
                      <Pie
                        data={congDist.filter(d => d.count > 0)}
                        dataKey="count"
                        nameKey="level"
                        cx="50%"
                        cy="50%"
                        innerRadius="50%"
                        outerRadius="78%"
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {congDist.filter(d => d.count > 0).map((entry) => (
                          <Cell key={entry.level} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', fontSize: 11 }}
                        formatter={(val: number, name: string) => [`${val} (${totalCong > 0 ? Math.round(val / totalCong * 100) : 0}%)`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2.5">
                    {congDist.map(d => {
                      const pct = totalCong > 0 ? Math.round(d.count / totalCong * 100) : 0;
                      return (
                        <div key={d.level} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{d.level}</span>
                            </div>
                            <span className="text-[10px] font-mono text-foreground">{pct}%</span>
                          </div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-[9px] text-muted-foreground">{totalCong.toLocaleString()} total readings</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold tracking-widest text-muted-foreground">AVG SPEED BY HOUR</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              {hourlyLoading ? <Skeleton className="w-full h-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={9} minTickGap={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={30} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} km/h`, "Avg Speed"]} />
                    <Area
                      type="monotone"
                      dataKey="avg_speed"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      fill="url(#speedGrad)"
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
