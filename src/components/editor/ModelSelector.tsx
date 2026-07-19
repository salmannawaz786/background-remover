"use client";
import { useState } from "react";
import { Zap, Crown, Lock, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  isAuthenticated: boolean;
  authChecked?: boolean;
}

export default function ModelSelector({ isAuthenticated, authChecked = true }: Props) {
  const selectedModel   = useStore(s => s.selectedModel);
  const setSelectedModel = useStore(s => s.setSelectedModel);
  const [showSignInTip, setShowSignInTip] = useState(false);
  const router = useRouter();

  const handleProClick = () => {
    if (authChecked && !isAuthenticated) {
      setShowSignInTip(true);
      setTimeout(() => setShowSignInTip(false), 4000);
      return;
    }
    if (!authChecked) return;
    setSelectedModel("pro");
  };

  return (
    <div className="relative flex flex-col items-center gap-1">
      <div className="flex items-center gap-1 p-1 glass rounded-xl border border-[var(--glass-border)]">
        {/* Fast */}
        <button
          onClick={() => setSelectedModel("fast")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
            ${selectedModel === "fast"
              ? "btn-gradient text-black shadow-sm"
              : "text-muted-foreground hover:text-foreground"
            }`}
        >
          <Zap size={13} />
          <span className="hidden sm:inline">Fast</span>
          <span className="text-[10px] opacity-70">Free</span>
        </button>

        {/* Pro */}
        <button
          onClick={handleProClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 relative
            ${selectedModel === "pro"
              ? "btn-gradient text-black shadow-sm"
              : !authChecked
                ? "text-muted-foreground/60"
                : !isAuthenticated
                  ? "text-muted-foreground/60 hover:text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }`}
        >
          {!authChecked ? <Lock size={12} /> : !isAuthenticated ? <Lock size={12} /> : <Crown size={13} />}
          <span className="hidden sm:inline">Pro</span>
        </button>
      </div>

      {/* Sign-in tip popover */}
      <AnimatePresence>
        {showSignInTip && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full mt-2 z-50 w-56 glass border border-[var(--glass-border)] rounded-2xl p-3 shadow-2xl text-center"
          >
            <button onClick={() => setShowSignInTip(false)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
            <Crown size={20} className="text-primary mx-auto mb-1.5" />
            <p className="text-xs font-semibold text-foreground mb-0.5">Pro mode requires sign in</p>
            <p className="text-xs text-muted-foreground mb-2.5">
              Higher quality model — sign in for free.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full btn-gradient text-black text-xs font-semibold py-1.5 rounded-xl"
            >
              Sign in → Unlock Pro
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
