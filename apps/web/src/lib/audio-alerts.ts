/**
 * Emergency audio alert service using the Web Audio API.
 * No audio files required — synthesises a two-tone siren entirely in-browser.
 */

let audioCtx: AudioContext | null = null;
let sirenTimer: ReturnType<typeof setTimeout> | null = null;
let sirenActive = false;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, startTime: number): void {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(frequency, startTime);
  osc.frequency.linearRampToValueAtTime(frequency * 1.3, startTime + duration / 2);
  osc.frequency.linearRampToValueAtTime(frequency, startTime + duration);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.25, startTime + 0.05);
  gain.gain.linearRampToValueAtTime(0.25, startTime + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playEmergencySiren(): void {
  if (sirenActive) return;
  sirenActive = true;

  const ctx = getCtx();
  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => undefined);
  }

  let cycle = 0;
  const maxCycles = 6;

  function doSirenCycle() {
    if (cycle >= maxCycles) {
      sirenActive = false;
      return;
    }
    const now = ctx.currentTime;
    playTone(880, 0.25, now);
    playTone(660, 0.25, now + 0.25);
    cycle++;
    sirenTimer = setTimeout(doSirenCycle, 520);
  }

  doSirenCycle();
}

export function stopSiren(): void {
  if (sirenTimer !== null) clearTimeout(sirenTimer);
  sirenActive = false;
}

export function requestNotificationPermission(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => undefined);
  }
}

export function showEmergencyNotification(vehicleType: string, laneId: number, confidence: number): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const typeLabel = vehicleType.replace(/_/g, " ");
  const laneLabel = ["North", "South", "East", "West"][laneId] ?? `Lane ${laneId}`;
  new Notification("🚨 Emergency Vehicle Detected", {
    body: `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} approaching ${laneLabel} Bound (${Math.round(confidence * 100)}% confidence)`,
    icon: "/favicon.ico",
    requireInteraction: false,
    silent: true,
  });
}
