"use client";
import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronsLeftRight } from "lucide-react";

interface Props {
  before: string;
  after: string;
}

export default function BeforeAfterSlider({ before, after }: Props) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPosition(pct);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative rounded-2xl overflow-hidden select-none max-h-[60vh] sm:max-h-[65vh] flex items-center justify-center bg-muted/20"
      ref={containerRef}
      style={{ cursor: "col-resize" }}
      onMouseDown={(e) => { dragging.current = true; updatePosition(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updatePosition(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => { dragging.current = true; updatePosition(e.touches[0].clientX); }}
      onTouchMove={(e) => { if (dragging.current) updatePosition(e.touches[0].clientX); }}
      onTouchEnd={() => { dragging.current = false; }}
    >
      {/* After (full width) */}
      <img src={after} alt="After" className="w-full h-auto block max-h-[60vh] sm:max-h-[65vh] object-contain" draggable={false} />

      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={before} alt="Before" className="w-full h-auto block max-h-[60vh] sm:max-h-[65vh] object-contain" draggable={false} />
        <div className="absolute top-3 left-3 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
          Before
        </div>
      </div>

      {/* After label */}
      <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
        After
      </div>

      {/* Drag handle */}
      <div
        className="absolute top-0 bottom-0 flex items-center justify-center"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      >
        <div className="w-0.5 h-full bg-white/80 absolute" />
        <div className="relative z-10 w-10 h-10 rounded-full bg-white shadow-2xl flex items-center justify-center">
          <ChevronsLeftRight size={16} className="text-gray-700" />
        </div>
      </div>
    </motion.div>
  );
}
