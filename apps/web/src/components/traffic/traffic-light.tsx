import { cn } from "@/lib/utils";

interface TrafficLightProps {
  phase: string;
  timeRemaining?: number;
  emergency?: boolean;
}

export function TrafficLight({ phase, timeRemaining, emergency }: TrafficLightProps) {
  const isRed = phase === 'red' || phase === 'all_red';
  const isYellow = phase === 'yellow';
  const isGreen = phase === 'green';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-card-border p-3 rounded-xl border flex flex-col gap-3 relative shadow-inner">
        {emergency && (
          <div className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded animate-pulse border border-destructive/50">
            EMG
          </div>
        )}
        
        {/* Red Light */}
        <div className={cn(
          "w-8 h-8 rounded-full border border-black/50 transition-all duration-300",
          isRed ? "bg-red-500 glow-red" : "bg-red-950 opacity-20"
        )} />
        
        {/* Yellow Light */}
        <div className={cn(
          "w-8 h-8 rounded-full border border-black/50 transition-all duration-300",
          isYellow ? "bg-yellow-400 glow-yellow" : "bg-yellow-950 opacity-20"
        )} />
        
        {/* Green Light */}
        <div className={cn(
          "w-8 h-8 rounded-full border border-black/50 transition-all duration-300 flex items-center justify-center",
          isGreen ? "bg-green-500 glow-green" : "bg-green-950 opacity-20"
        )}>
          {isGreen && timeRemaining !== undefined && (
            <span className="text-[10px] font-bold text-black">{timeRemaining}</span>
          )}
        </div>
      </div>
    </div>
  );
}
