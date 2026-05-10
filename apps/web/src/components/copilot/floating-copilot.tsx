import { useState, useRef, useEffect } from "react";
import { useTrafficStore } from "@/lib/store";
import { Bot, Send, Loader2, X, Minimize2, Maximize2, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const EXAMPLE_COMMANDS = [
  "Hold North green for 2 minutes",
  "What's causing the East lane backup?",
  "Switch to rush hour mode",
  "Reset junction to defaults",
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
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={cn("flex gap-2 mb-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-[#1d6bf3]/20 border border-[#1d6bf3]/50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-3 h-3 text-[#1d6bf3]" />
        </div>
      )}
      <div className={cn(
        "max-w-[82%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed shadow-sm",
        isUser
          ? "bg-[#1d6bf3] text-white rounded-br-sm"
          : "bg-[#1e2130] border border-white/8 text-[#e2e8f0] rounded-bl-sm"
      )}>
        {msg.content}
        {msg.action && (
          <div className={cn(
            "mt-1.5 pt-1.5 border-t text-[10px] font-mono",
            isUser ? "border-white/20" : "border-white/8"
          )}>
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
              msg.success
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            )}>
              {msg.success ? "✓" : "✗"} {msg.action}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function FloatingCopilot() {
  const { copilotOpen, setCopilotOpen, lanes } = useTrafficStore();
  const [open, setOpenLocal] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isOpen = copilotOpen || open;
  const setOpen = (v: boolean) => { setOpenLocal(v); setCopilotOpen(v); };
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "Hi! I'm your AI Traffic Copilot. Tell me what you need — hold green phases, adjust modes, or ask about any lane.",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

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
      const data = await res.json() as {
        result: { message: string; action: string; success: boolean };
        explanation: string;
      };
      const reply: Message = {
        role: "assistant",
        content: data.result.message || data.explanation,
        action: data.result.action,
        success: data.result.success,
      };
      setMessages(prev => [...prev, reply]);
      if (!isOpen) setUnread(n => n + 1);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I ran into an error processing that command. Please try again.",
        success: false,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const panelWidth  = expanded ? 420 : 360;
  const panelHeight = expanded ? 600 : 480;

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-[9999]">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              onClick={() => setOpen(true)}
              className="relative w-14 h-14 rounded-full bg-[#1d6bf3] shadow-[0_4px_24px_rgba(29,107,243,0.55)] flex items-center justify-center hover:bg-[#1a5fd8] active:scale-95 transition-colors"
            >
              <MessageSquare className="w-6 h-6 text-white" />
              {/* Pulse ring */}
              <span className="absolute inset-0 rounded-full bg-[#1d6bf3]/40 animate-ping" style={{ animationDuration: "2.5s" }} />
              {/* Unread badge */}
              {unread > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow"
                >
                  {unread}
                </motion.span>
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Chat popup */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 20, transformOrigin: "bottom right" }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 20 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              style={{ width: panelWidth, height: panelHeight }}
              className="absolute bottom-0 right-0 flex flex-col rounded-2xl overflow-hidden border border-white/10 shadow-[0_8px_48px_rgba(0,0,0,0.6)] bg-[#13161f]"
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-[#1d6bf3] flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight">AI Traffic Copilot</p>
                  <p className="text-white/70 text-[10px] leading-tight flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Online · Gemini-powered
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setExpanded(e => !e)}
                    className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    {expanded
                      ? <Minimize2 className="w-3.5 h-3.5 text-white/80" />
                      : <Maximize2 className="w-3.5 h-3.5 text-white/80" />
                    }
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-white/80" />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 min-h-0 space-y-0">
                {messages.map((msg, i) => (
                  <MessageBubble key={i} msg={msg} />
                ))}
                {loading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex gap-2 mb-3"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#1d6bf3]/20 border border-[#1d6bf3]/50 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-3 h-3 text-[#1d6bf3]" />
                    </div>
                    <div className="bg-[#1e2130] border border-white/8 px-3 py-2.5 rounded-2xl rounded-bl-sm">
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Quick chips */}
              <div className="px-3 py-2 flex gap-1.5 overflow-x-auto scrollbar-none flex-shrink-0">
                {EXAMPLE_COMMANDS.map((cmd, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(cmd)}
                    className="flex-shrink-0 text-[10px] px-2.5 py-1 bg-white/5 border border-white/10 text-slate-400 rounded-full hover:border-[#1d6bf3]/60 hover:text-[#1d6bf3] transition-colors whitespace-nowrap"
                  >
                    {cmd.slice(0, 28)}…
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="px-3 pb-3 flex gap-2 flex-shrink-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()}
                  placeholder="Type a command in plain English..."
                  className="flex-1 bg-[#1e2130] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-[#e2e8f0] placeholder:text-slate-500 focus:outline-none focus:border-[#1d6bf3]/60 transition-colors"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim()}
                  className="w-10 h-10 rounded-xl bg-[#1d6bf3] text-white flex items-center justify-center hover:bg-[#1a5fd8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />
                  }
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
