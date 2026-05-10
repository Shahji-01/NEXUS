import { useEffect, useRef } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { EmergencyBanner } from "./emergency-banner";
import { useTrafficStore } from "@/lib/store";
import { useAlerts } from "@/hooks/use-alerts";
import { useGetLiveTraffic, useGetSignalState, getGetLiveTrafficQueryKey, getGetSignalStateQueryKey } from "@workspace/api-client-react";
import { playEmergencySiren, requestNotificationPermission, showEmergencyNotification } from "@/lib/audio-alerts";

export function Shell({ children }: { children: React.ReactNode }) {
  const { setConnected, updateData, connected } = useTrafficStore();
  const lastEmergencyId = useRef<number | null>(null);

  // Run alert detection globally
  useAlerts();

  // Polling fallback when WebSocket is disconnected
  useGetLiveTraffic({
    query: {
      queryKey: getGetLiveTrafficQueryKey(),
      refetchInterval: connected ? false : 2000,
      enabled: !connected,
    }
  });

  useGetSignalState({
    query: {
      queryKey: getGetSignalStateQueryKey(),
      refetchInterval: connected ? false : 2000,
      enabled: !connected,
    }
  });

  useEffect(() => {
    document.documentElement.classList.add('dark');

    const apiBaseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const wsProtocol = apiBaseUrl.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = apiBaseUrl.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}//${wsHost}/api/ws`;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        requestNotificationPermission();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'traffic_update') {
            updateData(data);
            // Fire siren + notification when a new emergency starts
            const emg = data.emergency;
            if (emg && !emg.resolved && emg.id !== lastEmergencyId.current) {
              lastEmergencyId.current = emg.id;
              playEmergencySiren();
              showEmergencyNotification(emg.vehicle_type, emg.lane_id, emg.confidence);
            }
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        clearTimeout(reconnectTimeout);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [setConnected, updateData]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-primary/30">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <EmergencyBanner />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
