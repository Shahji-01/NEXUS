import { useState, useRef, useEffect } from "react";
import { API_URL } from "@/lib/api";
import { useTrafficStore } from "@/lib/store";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Send, Bot, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const EXAMPLE_COMMANDS = [
  "Hold North green for 2 minutes, ambulance incoming",
  "What's causing the backup on East lane?",
  "Switch all junctions to rush hour mode",
  "Reset junction to default timing",
  "How bad is congestion right now?",
];

interface Message {
  role: "user" | "assistant";
  content: string;
  action?: string;
  success?: boolean;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex mb-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div className={cn(
        "max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-muted border border-border/60 text-foreground rounded-bl-sm"
      )}>
        {msg.content}
        {msg.action && (
          <div className={cn("mt-1.5 pt-1.5 border-t", isUser ? "border-primary-foreground/30" : "border-border/50")}>
            <span className={cn(
              "text-xs font-mono px-2 py-0.5 rounded-full",
              msg.success ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
            )}>
              {msg.success ? "✓" : "✗"} {msg.action}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function CopilotPanel() {
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "Hi! I'm your AI Traffic Copilot. Tell me what you need — I can hold green phases, adjust signal modes, or explain what's happening on any lane.",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { lanes } = useTrafficStore();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    const lanesArr = Object.values(lanes).map(l => ({
      direction: ["north", "south", "east", "west"][l.lane_id],
      vehicle_count: l.vehicle_count,
      density: l.density,
      congestion_level: l.congestion_level,
      avg_speed_kmh: l.avg_speed,
    }));

    try {
      const res = await fetch(`${API_URL}/copilot/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, traffic_context: { lanes: lanesArr } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { result: { message: string; action: string; success: boolean }; explanation: string };
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.result.message || data.explanation,
        action: data.result.action,
        success: data.result.success,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I ran into an error. Please try again.",
        success: false,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-card/40 backdrop-blur border-border/50 flex flex-col h-[520px]">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex-row items-center gap-2 space-y-0">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-sm font-semibold">AI Traffic Copilot</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">Claude-powered</span>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 min-h-0">
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start mb-3">
            <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center mr-2 flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="bg-muted border border-border/60 px-3.5 py-2.5 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </CardContent>

      <div className="px-4 py-2 border-t border-border/30">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {EXAMPLE_COMMANDS.map((cmd, i) => (
            <button key={i} onClick={() => sendMessage(cmd)}
              className="flex-shrink-0 text-[10px] px-2.5 py-1 bg-muted/60 text-muted-foreground border border-border/50 rounded-full hover:border-primary/50 hover:text-primary transition-colors">
              {cmd.slice(0, 30)}…
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border/50 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Type a command in plain English..."
          className="flex-1 bg-muted/60 border border-border/60 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </Card>
  );
}
