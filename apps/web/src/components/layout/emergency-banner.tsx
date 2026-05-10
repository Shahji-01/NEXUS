import { useTrafficStore } from "@/lib/store";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const LANE_LABELS: Record<number, string> = {
  0: "North Bound", 1: "South Bound", 2: "East Bound", 3: "West Bound",
};

const EMERG_ICONS: Record<string, string> = {
  ambulance: "🚑",
  fire_truck: "🚒",
  police: "🚓",
};

export function EmergencyBanner() {
  const { activeEmergency } = useTrafficStore();
  const [location, navigate] = useLocation();

  const isEmergencyPage = location === "/emergency";

  return (
    <AnimatePresence>
      {activeEmergency && !isEmergencyPage && (
        <motion.div
          key="emergency-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden shrink-0"
        >
          <div className="bg-red-950/80 border-b border-red-500/40 px-6 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Pulsing dot */}
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>

              <span className="text-xs font-bold tracking-wider text-red-300 uppercase">
                Emergency Active
              </span>

              <span className="text-sm">
                {EMERG_ICONS[activeEmergency.vehicle_type?.toLowerCase().replace(" ", "_")] ?? "🚨"}
              </span>

              <span className="text-xs text-red-200 font-mono">
                {activeEmergency.vehicle_type?.toUpperCase()} —{" "}
                {LANE_LABELS[activeEmergency.lane_id as number] ?? `Lane ${activeEmergency.lane_id}`} — Green corridor active
              </span>

              <span className="text-[10px] text-red-400/70 font-mono hidden sm:inline">
                {Math.round((activeEmergency.confidence ?? 0) * 100)}% confidence
              </span>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/emergency")}
              className="border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200 text-[10px] h-7 px-3 font-mono tracking-wider shrink-0"
            >
              VIEW DETAILS
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
