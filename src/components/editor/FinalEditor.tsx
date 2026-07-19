"use client";
import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";
import { ChevronsLeftRight, Palette, ImageIcon, X, ImagePlus, Upload } from "lucide-react";
import { toast } from "sonner";

export type BgMode = "transparent" | "color" | "image";
export interface BgChoice {
  mode: BgMode;
  color: string;
  image: string | null;
}

interface Props {
  before: string;
  after: string;
  onBgChange?: (choice: BgChoice) => void;
}

const COLOR_PRESETS = [
  "#ffffff", "#000000", "#dcb15c", "#fde68a",
  "#ef4444", "#f97316", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#6b7280", "#0ea5e9",
];

const FinalEditor = forwardRef<{ getBg: () => BgChoice }, Props>(function FinalEditor(
  { before, after, onBgChange },
  ref
) {
  const [position, setPosition] = useState(50);
  const [mode, setMode] = useState<BgMode>("transparent");
  const [bgColor, setBgColor] = useState<string>("#ffffff");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  const updatePosition = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPosition(pct);
  }, []);

  useImperativeHandle(ref, () => ({
    getBg: () => ({ mode, color: bgColor, image: bgImage }),
  }), [mode, bgColor, bgImage]);

  useEffect(() => {
    onBgChange?.({ mode, color: bgColor, image: bgImage });
  }, [mode, bgColor, bgImage, onBgChange]);

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Background image is too large. Max 10MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setBgImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const containerStyle: React.CSSProperties =
    mode === "color"
      ? { backgroundColor: bgColor }
      : mode === "image" && bgImage
        ? {
            backgroundImage: `url(${bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : {
            backgroundImage:
              "linear-gradient(45deg, #1f2937 25%, transparent 25%), linear-gradient(-45deg, #1f2937 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f2937 75%), linear-gradient(-45deg, transparent 75%, #1f2937 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            backgroundColor: "#374151",
          };

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Hidden bg image input */}
      <input
        ref={bgImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBgImageUpload}
      />

      {/* Canvas / before-after slider */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative rounded-2xl overflow-hidden select-none max-h-[55vh] sm:max-h-[60vh] flex items-center justify-center glass border border-[var(--glass-border)]"
        ref={containerRef}
        style={{ ...containerStyle, cursor: "col-resize" }}
        onMouseDown={(e) => { dragging.current = true; updatePosition(e.clientX); }}
        onMouseMove={(e) => { if (dragging.current) updatePosition(e.clientX); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
        onTouchStart={(e) => { dragging.current = true; updatePosition(e.touches[0].clientX); }}
        onTouchMove={(e) => { if (dragging.current) updatePosition(e.touches[0].clientX); }}
        onTouchEnd={() => { dragging.current = false; }}
      >
        {/* After (full width) */}
        <img
          src={after}
          alt="After"
          className="w-full h-auto block max-h-[55vh] sm:max-h-[60vh] object-contain"
          draggable={false}
        />

        {/* Before (clipped) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={before}
            alt="Before"
            className="w-full h-auto block max-h-[55vh] sm:max-h-[60vh] object-contain"
            draggable={false}
          />
        </div>

        {/* Before label - lives OUTSIDE the clip so it never gets cropped */}
        <div
          className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-black/70 text-white text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full pointer-events-none transition-opacity"
          style={{ opacity: position < 4 ? 0 : 1 }}
        >
          Before
        </div>

        {/* After label - mirrors Before, fades out when slider is fully right */}
        <div
          className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-black/70 text-white text-[10px] sm:text-xs font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full pointer-events-none transition-opacity"
          style={{ opacity: position > 96 ? 0 : 1 }}
        >
          After
        </div>

        {/* Drag handle */}
        <div
          className="absolute top-0 bottom-0 flex items-center justify-center"
          style={{ left: `${position}%`, transform: "translateX(-50%)" }}
        >
          <div className="w-0.5 h-full bg-white/80 absolute" />
          <div className="relative z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white shadow-2xl flex items-center justify-center">
            <ChevronsLeftRight size={14} className="text-gray-700 sm:hidden" />
            <ChevronsLeftRight size={16} className="text-gray-700 hidden sm:block" />
          </div>
        </div>
      </motion.div>

      {/* Background mode selector */}
      <div className="glass border border-[var(--glass-border)] rounded-2xl p-2.5 sm:p-3 flex flex-col gap-3">
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-[var(--glass-border)] self-start">
          <button
            onClick={() => setMode("transparent")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${mode === "transparent" ? "btn-gradient text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ImageIcon size={12} /> Transparent
          </button>
          <button
            onClick={() => setMode("color")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${mode === "color" ? "btn-gradient text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Palette size={12} /> Color
          </button>
          <button
            onClick={() => setMode("image")}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${mode === "image" ? "btn-gradient text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ImagePlus size={12} /> Image
          </button>
        </div>

        {mode === "color" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBgColor(c)}
                  aria-label={`Pick color ${c}`}
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 transition-all ${
                    bgColor.toLowerCase() === c.toLowerCase()
                      ? "border-primary scale-110 ring-2 ring-primary/40"
                      : "border-white/30 hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Custom:</span>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg cursor-pointer bg-transparent border border-[var(--glass-border)]"
                aria-label="Pick custom color"
              />
              <span className="text-xs font-mono text-muted-foreground">{bgColor.toUpperCase()}</span>
            </div>
          </div>
        )}

        {mode === "image" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => bgImageInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full glass border border-[var(--glass-border)] text-xs sm:text-sm font-medium text-foreground hover:border-primary/50 transition-all"
            >
              <Upload size={13} /> {bgImage ? "Change image" : "Upload background image"}
            </button>
            {bgImage && (
              <button
                onClick={() => setBgImage(null)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full glass border border-red-500/20 text-xs sm:text-sm font-medium text-red-500/70 hover:text-red-500 transition-all"
              >
                <X size={12} /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default FinalEditor;
