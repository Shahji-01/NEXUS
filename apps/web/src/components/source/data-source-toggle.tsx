import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTrafficStore } from "@/lib/store";
import { API_URL } from "@/lib/api";
import { toast } from "sonner";
import { Video, Cpu } from "lucide-react";

type DataSourceMode = "simulation" | "video";

/**
 * DataSourceToggle
 *
 * Switches the active traffic data source between the synthetic simulation
 * engine and the computer-vision video detector by calling
 * `POST /api/source/mode`.
 *
 * The authoritative mode is owned by the server and is broadcast to every
 * client through the WebSocket `data_source` field (mirrored into the Zustand
 * store as `dataSource.mode`). All clients converge on that value (R7.7).
 *
 * While a mode change is in flight we reflect the chosen mode optimistically;
 * once the store value catches up the optimistic state is dropped so the
 * authoritative value wins. On error the optimistic state is reverted (R7.3).
 *
 * NOTE: the OpenAPI codegen (task 9.4) does not (yet) emit a `useSetDataSourceMode`
 * hook, so this uses a React Query mutation over `customFetch`-style fetch to the
 * documented endpoint as the fallback path.
 */
export function DataSourceToggle({ className }: { className?: string }) {
  const dataSource = useTrafficStore((s) => s.dataSource);
  const authoritativeMode: DataSourceMode = dataSource?.mode ?? "simulation";

  // Optimistic mode while the mutation is in flight. `null` means "trust the store".
  const [optimisticMode, setOptimisticMode] = useState<DataSourceMode | null>(null);

  const setMode = useMutation({
    mutationFn: async (mode: DataSourceMode) => {
      const res = await fetch(`${API_URL}/source/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        throw new Error(`Failed to set data source mode (HTTP ${res.status})`);
      }
      return (await res.json()) as { mode: DataSourceMode };
    },
    onError: () => {
      // Revert optimistic state; the authoritative store value wins again.
      setOptimisticMode(null);
      toast.error("Failed to switch data source", {
        description: "The detector may be unavailable. Reverted to the active source.",
      });
    },
  });

  // Once the authoritative store value converges on our optimistic choice,
  // drop the optimistic override so the server stays the source of truth.
  useEffect(() => {
    if (optimisticMode !== null && authoritativeMode === optimisticMode) {
      setOptimisticMode(null);
    }
  }, [authoritativeMode, optimisticMode]);

  const displayMode: DataSourceMode = optimisticMode ?? authoritativeMode;
  const isVideo = displayMode === "video";

  const handleToggle = (checked: boolean) => {
    const next: DataSourceMode = checked ? "video" : "simulation";
    if (next === displayMode) return;
    setOptimisticMode(next);
    setMode.mutate(next);
  };

  return (
    <div
      className={`flex items-center justify-between gap-4 bg-primary/10 border border-primary/20 p-4 rounded-lg ${className ?? ""}`}
    >
      <div className="flex items-center gap-3">
        {isVideo ? (
          <Video className={`w-8 h-8 text-primary ${setMode.isPending ? "animate-pulse" : ""}`} />
        ) : (
          <Cpu className="w-8 h-8 text-muted-foreground" />
        )}
        <div>
          <h2 className="font-bold text-base flex items-center gap-2">
            DATA SOURCE:{" "}
            <span className={isVideo ? "text-primary" : "text-muted-foreground"}>
              {isVideo ? "VIDEO (CV DETECTION)" : "SIMULATION"}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {setMode.isPending
              ? "Switching data source..."
              : isVideo
                ? "Lane data is derived from live computer-vision detection on the demo clips."
                : "Lane data is produced by the synthetic simulation engine."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="data-source-mode" className="font-mono uppercase text-xs tracking-widest">
          Video Detection
        </Label>
        <Switch
          id="data-source-mode"
          checked={isVideo}
          onCheckedChange={handleToggle}
          disabled={setMode.isPending}
        />
      </div>
    </div>
  );
}
