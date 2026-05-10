import { LaneData } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Car, Bike, Truck, Bus } from "lucide-react";

interface LaneCardProps {
  lane: LaneData;
  name: string;
}

export function LaneCard({ lane, name }: LaneCardProps) {
  const getCongestionColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-500';
      case 'medium': return 'bg-yellow-500';
      case 'high': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-primary';
    }
  };

  const getDirectionIcon = (id: number) => {
    switch(id) {
      case 0: return <ArrowUp className="w-4 h-4 text-muted-foreground" />; // North
      case 1: return <ArrowDown className="w-4 h-4 text-muted-foreground" />; // South
      case 2: return <ArrowRight className="w-4 h-4 text-muted-foreground" />; // East
      case 3: return <ArrowLeft className="w-4 h-4 text-muted-foreground" />; // West
      default: return null;
    }
  };

  return (
    <Card className="overflow-hidden border-border/50 bg-card/40 backdrop-blur">
      <CardContent className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getDirectionIcon(lane.lane_id)}
            <h3 className="font-mono text-sm font-semibold tracking-wider text-muted-foreground">{name}</h3>
          </div>
          <div className={cn(
            "text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm bg-background border",
            lane.congestion_level === 'critical' && "text-red-500 border-red-500/20",
            lane.congestion_level === 'high' && "text-orange-500 border-orange-500/20",
            lane.congestion_level === 'medium' && "text-yellow-500 border-yellow-500/20",
            lane.congestion_level === 'low' && "text-green-500 border-green-500/20"
          )}>
            {lane.congestion_level}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Vehicles</div>
            <div className="text-2xl font-mono text-foreground font-light">
              {lane.vehicle_count}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Avg Speed</div>
            <div className="text-2xl font-mono text-foreground font-light">
              {lane.avg_speed || 0}<span className="text-sm text-muted-foreground ml-1">km/h</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
            <span>Density</span>
            <span>{lane.density}%</span>
          </div>
          <Progress 
            value={lane.density} 
            className="h-1.5 bg-muted"
            indicatorClassName={cn(getCongestionColor(lane.congestion_level))}
          />
        </div>

        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/50">
          <div className="flex flex-col items-center gap-1">
            <Car className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-mono">{lane.cars || 0}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Truck className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-mono">{lane.trucks || 0}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Bus className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-mono">{lane.buses || 0}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Bike className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-mono">{lane.bikes || 0}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
