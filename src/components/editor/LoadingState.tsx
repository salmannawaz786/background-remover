"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, Sparkles } from "lucide-react";

const BG_MESSAGES = [
  "Analyzing your image…",
  "Detecting the subject…",
  "Separating foreground…",
  "Removing background…",
  "Cleaning up edges…",
  "Exporting transparent PNG…",
];

const PRO_BG_MESSAGES = [
  "Preparing Pro engine…",
  "Analyzing image details…",
  "Detecting subject boundaries…",
  "Refining hair & fur edges…",
  "Removing background accurately…",
  "Polishing transparency…",
];

interface Props {
  modelDownloadPct?: number;
  model?: "fast" | "pro";
  context?: "bg";
}

export default function LoadingState({ modelDownloadPct, model = "fast", context = "bg" }: Props) {
  const messages = context === "bg" ? (model === "pro" ? PRO_BG_MESSAGES : BG_MESSAGES) : BG_MESSAGES;
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMsgIndex(i => (i + 1) % messages.length);
    }, 1800);
    return () => clearInterval(id);
  }, [messages]);

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16 px-4 text-center">
      {/* Spinner */}
      <div className="relative w-28 h-28 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-primary/15" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
        <div className="w-14 h-14 rounded-full btn-gradient flex items-center justify-center shadow-[0_0_24px_rgba(220,177,92,0.5)]">
          <Wand2 size={24} className="text-black" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <AnimatePresence mode="wait">
          <motion.p
            key={msgIndex}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
            className="text-lg font-bold gradient-text"
          >
            {messages[msgIndex]}
          </motion.p>
        </AnimatePresence>

        <p className="text-sm text-muted-foreground font-medium">
          {model === "pro" ? "High quality AI processing" : "Fast processing"}
        </p>
      </div>

      {modelDownloadPct !== undefined && modelDownloadPct < 100 && (
        <div className="w-72 mt-4 glass p-4 rounded-2xl border border-[var(--glass-border)]">
          <div className="flex items-center justify-between text-xs text-foreground mb-3 font-medium">
            <span className="flex items-center gap-1.5"><Sparkles size={12} className="text-primary"/> Downloading Pro Model…</span>
            <span className="font-bold text-primary">{modelDownloadPct}%</span>
          </div>
          <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
            <motion.div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full relative"
              initial={{ width: 0 }}
              animate={{ width: `${modelDownloadPct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            First download is large ({">"}90MB). Subsequent visits use cache.
          </p>
        </div>
      )}
    </div>
  );
}
