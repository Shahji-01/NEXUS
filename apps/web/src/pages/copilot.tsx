import { useEffect } from "react";
import { Shell } from "@/components/layout/shell";
import { Bot, MessageSquare, Zap, Radio } from "lucide-react";
import { useTrafficStore } from "@/lib/store";

const CAPABILITIES = [
  {
    icon: MessageSquare,
    label: "Signal Control",
    desc: "Hold any lane green, extend or shorten phases, or manually override timing for a specific duration.",
    examples: ["Hold North green for 2 minutes", "Extend East green by 45 seconds"],
  },
  {
    icon: Zap,
    label: "Mode Switching",
    desc: "Switch all junctions between normal, rush hour, and night modes with a single command.",
    examples: ["Switch to rush hour mode", "Activate night mode"],
  },
  {
    icon: Radio,
    label: "Status Queries",
    desc: "Ask in plain English about current congestion, density, or which lane has the most traffic.",
    examples: ["What's causing the East backup?", "How bad is congestion right now?"],
  },
];

export default function CopilotPage() {
  const { setCopilotOpen } = useTrafficStore();

  useEffect(() => {
    const t = setTimeout(() => setCopilotOpen(true), 300);
    return () => { clearTimeout(t); setCopilotOpen(false); };
  }, [setCopilotOpen]);

  return (
    <Shell>
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#1d6bf3]/15 border border-[#1d6bf3]/30 flex items-center justify-center mx-auto">
            <Bot className="w-8 h-8 text-[#1d6bf3]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Traffic Copilot</h1>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              Powered by Claude. Type plain English commands — the AI understands your intent, executes actions on the live junction system, and explains exactly what it did.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-sm text-[#1d6bf3] bg-[#1d6bf3]/10 border border-[#1d6bf3]/20 rounded-full px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-[#1d6bf3] animate-pulse" />
            Click the blue chat bubble in the bottom-right corner to open
          </div>
        </div>

        {/* Capability cards */}
        <div className="space-y-3">
          {CAPABILITIES.map(({ icon: Icon, label, desc, examples }) => (
            <div key={label} className="bg-card/40 border border-border/50 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#1d6bf3]/10 border border-[#1d6bf3]/20 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-[#1d6bf3]" />
                </div>
                <p className="font-semibold text-sm">{label}</p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              <div className="flex flex-wrap gap-2">
                {examples.map(ex => (
                  <span key={ex} className="text-[11px] font-mono px-2.5 py-1 bg-muted/60 border border-border/50 rounded-lg text-muted-foreground">
                    "{ex}"
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/50">
          Actions are executed immediately against the live simulation · Claude Haiku model
        </p>
      </div>
    </Shell>
  );
}
