import { Router } from "express";
import { genAI } from "@workspace/integrations-google-ai";
import { simulator } from "../lib/simulation";
import { logger } from "../lib/logger";

const router = Router();

const SYSTEM_PROMPT = `You are the AI Copilot for a smart traffic junction management system called NEXUS.
Your job is to interpret operator commands and return structured JSON actions.

You have access to these actions:
1. hold_green      — hold a specific lane green for N seconds
   params: lane (north/south/east/west/all), duration_s (int, default 60)
2. set_mode        — switch junction mode
   params: mode (normal/rush_hour/night/emergency)
3. reset_junction  — reset junction to default timing
   params: (none needed)
4. explain_status  — explain current traffic state in plain English
   params: lane (optional, one of north/south/east/west)
5. query_density   — answer a question about current traffic density
   params: lane (optional)
6. toggle_ai       — toggle AI mode on or off
   params: enabled (boolean)

Always respond with valid JSON in this EXACT format (no markdown, no extra text):
{
  "intent": "<action_name>",
  "params": { <action params> },
  "explanation": "<one sentence explaining what you will do>",
  "confidence": <0.0 to 1.0>
}

If the command is unclear, use intent "clarify" with explanation asking for more detail.
Never make up data. Base status explanations on the traffic_context provided.`;

type LaneName = "north" | "south" | "east" | "west";
const LANE_MAP: Record<LaneName, number> = { north: 0, south: 1, east: 2, west: 3 };
const LANE_NAMES_ARR = ["North", "South", "East", "West"];

function buildTrafficContext() {
  const lanes = simulator.getLanes();
  const signals = simulator.getSignalState();
  return {
    lanes: Object.values(lanes).map(l => ({
      direction: ["north", "south", "east", "west"][l.lane_id],
      vehicle_count: l.vehicle_count,
      density: l.density,
      congestion_level: l.congestion_level,
      avg_speed_kmh: l.avg_speed,
    })),
    signals: {
      ai_mode: signals.ai_mode,
      current_green: signals.current_green !== null ? LANE_NAMES_ARR[signals.current_green] : null,
      emergency_active: signals.emergency_active,
    },
  };
}

function executeIntent(intent: string, params: Record<string, unknown>, ctx: ReturnType<typeof buildTrafficContext>): { success: boolean; action: string; message: string } {
  try {
    switch (intent) {
      case "hold_green": {
        const lane = String(params["lane"] ?? "north") as LaneName | "all";
        const duration = Number(params["duration_s"] ?? 60);
        if (lane === "all") {
          [0, 1, 2, 3].forEach(id => simulator.manualOverride(id, duration));
          return { success: true, action: "hold_green", message: `Holding all lanes green for ${duration}s.` };
        }
        const laneId = LANE_MAP[lane] ?? 0;
        simulator.manualOverride(laneId, duration);
        return { success: true, action: "hold_green", message: `Holding ${lane.toUpperCase()} green for ${duration}s.` };
      }
      case "set_mode": {
        const mode = String(params["mode"] ?? "normal");
        if (mode === "rush_hour") simulator.setAiMode(true);
        else if (mode === "night") simulator.setAiMode(false);
        else if (mode === "emergency") { [0, 1, 2, 3].forEach(id => simulator.activateEmergency(id)); }
        else simulator.setAiMode(true);
        return { success: true, action: "set_mode", message: `Junction mode switched to ${mode}.` };
      }
      case "reset_junction": {
        simulator.setAiMode(true);
        return { success: true, action: "reset_junction", message: "All junctions reset to AI-optimized defaults." };
      }
      case "toggle_ai": {
        const enabled = Boolean(params["enabled"] ?? true);
        simulator.setAiMode(enabled);
        return { success: true, action: "toggle_ai", message: `AI mode ${enabled ? "enabled" : "disabled"}.` };
      }
      case "explain_status": {
        const lane = params["lane"] ? String(params["lane"]) : null;
        const lanes = ctx.lanes;
        const targets = lane ? lanes.filter(l => l.direction === lane) : lanes;
        if (!targets.length) return { success: true, action: "explain_status", message: "No live traffic data available." };
        const busy  = targets.filter(l => l.density > 60).map(l => l.direction.toUpperCase());
        const clear = targets.filter(l => l.density < 30).map(l => l.direction.toUpperCase());
        const parts: string[] = [];
        if (busy.length) parts.push(`High congestion on ${busy.join(", ")} lanes.`);
        if (clear.length) parts.push(`${clear.join(", ")} lanes are clear.`);
        if (!parts.length) parts.push("Traffic is moderate across all monitored lanes.");
        return { success: true, action: "explain_status", message: parts.join(" ") };
      }
      case "query_density": {
        const lane = params["lane"] ? String(params["lane"]) : null;
        const lanes = ctx.lanes;
        if (lane) {
          const match = lanes.find(l => l.direction === lane);
          const msg = match
            ? `${lane.toUpperCase()} lane density is ${match.density.toFixed(0)}% with ${match.vehicle_count} vehicles.`
            : `No data for ${lane} lane.`;
          return { success: true, action: "query_density", message: msg };
        }
        const avg = lanes.reduce((s, l) => s + l.density, 0) / Math.max(lanes.length, 1);
        return { success: true, action: "query_density", message: `Average junction density is ${avg.toFixed(0)}%.` };
      }
      case "clarify":
        return { success: true, action: "clarify", message: String(params["explanation"] ?? "Could you clarify your command?") };
      default:
        return { success: false, action: intent, message: "Command not recognized." };
    }
  } catch (e) {
    return { success: false, action: intent, message: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

router.post("/copilot/command", async (req, res): Promise<void> => {
  const { message, traffic_context } = req.body as { message?: string; traffic_context?: unknown };
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message (string) required" });
    return;
  }

  const ctx = traffic_context as ReturnType<typeof buildTrafficContext> ?? buildTrafficContext();

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: SYSTEM_PROMPT,
    });

    const resultGemini = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `${message}\n\nCurrent system state:\n${JSON.stringify(ctx, null, 2)}` }] }],
      generationConfig: {
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    });
    const response = resultGemini.response;
    let text = response.text().trim();
    logger.info({ text }, "Gemini response text");

    // Strip markdown fences if present
    if (text.startsWith("```")) {
      text = text.split("```")[1] ?? "";
      if (text.startsWith("json")) text = text.slice(4);
      text = text.trim();
    }

    const parsed = JSON.parse(text) as { intent: string; params: Record<string, unknown>; explanation: string; confidence: number };
    logger.info({ parsed }, "Parsed copilot command");
    const result = executeIntent(parsed.intent, parsed.params, ctx);

    res.json({
      user_message: message,
      intent: parsed,
      result,
      explanation: parsed.explanation,
    });
  } catch (err) {
    logger.warn({ err }, "Copilot API error");
    res.status(500).json({ error: "Failed to process command", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
