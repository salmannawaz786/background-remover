"use client";
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import Script from "next/script";
import { ArrowLeft, Download, Sun, Moon, Wand2, ImagePlus, Layers, Smartphone, Clipboard, X, Clock, CheckCircle2, MoreVertical } from "lucide-react";
import { useStore } from "@/lib/store";
import { removeBackground, removeBackgroundClient, type BgModel, type BgFormat } from "@/lib/api";
import { toast } from "sonner";
import Image from "next/image";
import { isPWA } from "@/lib/pwa-utils";
import ModelSelector from "@/components/editor/ModelSelector";
import LoadingState from "@/components/editor/LoadingState";
import FinalEditor, { type BgChoice } from "@/components/editor/FinalEditor";
import UserMenu from "@/components/editor/UserMenu";
import BulkUploader from "@/components/editor/BulkUploader";
import CropModal, { cropImageToBlob, type CropArea } from "@/components/editor/CropModal";

type EditorTab = "single" | "bulk";

export default function EditorPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>("single");
  const [outputFormat, setOutputFormat] = useState<BgFormat>("png");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { user, uploadedImage, uploadedFile, resultImage, setResultImage, setUploadedImage, selectedModel } = useStore();
  const isAuthenticated = !!user;
  const [processing, setProcessing] = useState(false);
  const [processingMs, setProcessingMs] = useState<number | null>(null);
  const [modelDownloadPct, setModelDownloadPct] = useState<number | null>(null);
  const [clientProReady, setClientProReady] = useState(false);
  const [clientFastReady, setClientFastReady] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<"standard" | "full">("standard");
  const newImageInputRef = useRef<HTMLInputElement>(null);

  const BORDER_PRESETS = [
    { color: "#ffffff", label: "White" },
    { color: "#000000", label: "Black" },
    { color: "#dcb15c", label: "Gold" },
    { color: "#ef4444", label: "Red" },
    { color: "#3b82f6", label: "Blue" },
    { color: "#22c55e", label: "Green" },
    { color: "#8b5cf6", label: "Purple" },
    { color: "#ec4899", label: "Pink" },
  ];
  const [borderColor, setBorderColor] = useState<string | null>(null);
  const [borderWidth, setBorderWidth] = useState(20);

  const handleCropDone = useCallback(async (area: CropArea) => {
    if (!uploadedImage || !resultImage) return;
    setCropOpen(false);
    toast.info("Cropping both images...");
    try {
      const [origBlob, resBlob] = await Promise.all([
        cropImageToBlob(uploadedImage, area),
        cropImageToBlob(resultImage, area),
      ]);
      const origUrl = URL.createObjectURL(origBlob);
      const resUrl = URL.createObjectURL(resBlob);
      setUploadedImage(origUrl, null);
      setResultImage(resUrl);
      toast.success("Image cropped");
    } catch {
      toast.error("Crop failed");
    }
  }, [uploadedImage, resultImage, setUploadedImage, setResultImage]);

  // Lift bg choice out of FinalEditor so we can apply it on download
  const [bgChoice, setBgChoice] = useState<BgChoice>({ mode: "transparent", color: "#ffffff", image: null });
  const finalEditorRef = useRef<{ getBg: () => BgChoice } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Ctrl+V / Cmd+V clipboard paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            setResultImage(null);
            setUploadedImage(ev.target?.result as string, blob);
            setProcessingMs(null);
            toast.success("Image pasted from clipboard");
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [setUploadedImage, setResultImage]);

  const handleRemoveImage = () => {
    setResultImage(null);
    setUploadedImage(null, null);
    setProcessingMs(null);
    setMobileMenuOpen(false);
  };

  // On mount, start checking model status. The ClientProcessor auto-downloads
  // models in the background on init (Cache API persists them forever).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    const poll = async () => {
      try {
        const w = window as unknown as { ClientProcessor?: { init: () => Promise<void>; isModelReady: () => boolean; isFastModelReady: () => boolean; isModelDownloading: () => boolean } };
        if (!w.ClientProcessor) return;
        await w.ClientProcessor.init();
        if (!alive) return;
        if (w.ClientProcessor.isModelReady()) setClientProReady(true);
        if (w.ClientProcessor.isFastModelReady()) setClientFastReady(true);
        if (!w.ClientProcessor.isModelReady() || !w.ClientProcessor.isFastModelReady()) {
          setTimeout(poll, 3000);
        }
      } catch { /* ignore */ }
    };
    poll();
    return () => { alive = false; };
  }, []);

  // Downscale image before processing — all models compute masks at ≤1024px
  // internally, so 1600px input loses almost nothing but uploads/transfers ~10x faster.
  const downscaleImage = useCallback(async (blob: Blob, maxDim: number): Promise<Blob> => {
    const url = URL.createObjectURL(blob);
    try {
      const img = new window.Image();
      img.src = url;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img load")); });
      const W = img.naturalWidth, H = img.naturalHeight;
      if (Math.max(W, H) <= maxDim) return blob;
      const scale = maxDim / Math.max(W, H);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      return out ?? blob;
    } catch {
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  const handleNewImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file."); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      setResultImage(null);
      setUploadedImage(ev.target?.result as string, file);
      setProcessingMs(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
    setMobileMenuOpen(false);
  }, [setUploadedImage, setResultImage]);

  const handleProcess = async () => {
    if (!uploadedFile && !uploadedImage) {
      toast.error("No image found.");
      return;
    }

    setProcessing(true);
    setResultImage(null);
    setProcessingMs(null);

    const startedAt = performance.now();

    try {
      let rawBlob: Blob;
      if (uploadedFile) {
        rawBlob = uploadedFile;
      } else {
        const res = await fetch(uploadedImage!);
        rawBlob = await res.blob();
      }

      // Downscale to 1600px max before processing — huge speed win on mobile
      // (all models compute masks at ≤1024px internally anyway).
      const imageBlob = await downscaleImage(rawBlob, 1600);

      const fingerprint = (window as { userFingerprint?: string }).userFingerprint ?? "";

      let result;

      // Try on-device processing first (both fast and pro) — instant, no network.
      // Falls back to server until models finish downloading in the background.
      const clientResult = await removeBackgroundClient(imageBlob, selectedModel);
      if (clientResult.ok && clientResult.blob) {
        result = clientResult;
      } else {
        result = await removeBackground(imageBlob, selectedModel, outputFormat, fingerprint);
      }

      if (!result.ok) {
        if (result.requiresAuth && (result.proRequired || result.error === 'trial_expired' || result.error === 'fingerprint_blocked')) {
          toast.error(result.error || "Pro mode requires an account. Please sign up to continue.");
          router.push("/signup");
          return;
        }
        if (result.error === 'insufficient_credits') {
          toast.error("Not enough credits. Top up to continue.");
          return;
        }
        if (result.requiresAuth) {
          toast.error(result.error || "Please sign up to continue.");
          router.push("/signup");
          return;
        }
        toast.error(result.error ?? "Processing failed.");
        return;
      }

      const url = URL.createObjectURL(result.blob!);
      setResultImage(url);

      const totalMs = performance.now() - startedAt;
      setProcessingMs(totalMs);
      const location = result.usedClientSide ? " (on-device)" : "";
      toast.success(`Background removed!${location}`);
    } catch (err) {
      console.error("Processing error:", err);
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const compositeAndDownload = async (): Promise<void> => {
    if (!resultImage) return;
    const ext = outputFormat === "png" ? "png" : "webp";
    const mime = outputFormat === "png" ? "image/png" : "image/webp";

    const choice = finalEditorRef.current?.getBg() ?? bgChoice;

    const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Failed to load image"));
      i.src = src;
    });

    try {
      const resImg = await loadImg(resultImage);

      // Base RGBA: processed result, or full-res original with result's alpha
      // (remove.bg-style "full quality" download — edges stay at mask resolution
      // but colors/detail stay at original resolution)
      const base = document.createElement("canvas");
      const bctx = base.getContext("2d");
      if (!bctx) { toast.error("Canvas not supported"); return; }

      if (downloadQuality === "full" && uploadedImage) {
        const origImg = await loadImg(uploadedImage);
        base.width = origImg.naturalWidth;
        base.height = origImg.naturalHeight;
        bctx.drawImage(origImg, 0, 0);
        bctx.globalCompositeOperation = "destination-in";
        bctx.drawImage(resImg, 0, 0, base.width, base.height);
        bctx.globalCompositeOperation = "source-over";
      } else {
        base.width = resImg.naturalWidth;
        base.height = resImg.naturalHeight;
        bctx.drawImage(resImg, 0, 0);
      }

      const imgW = base.width, imgH = base.height;
      const bw = borderColor ? Math.round(borderWidth * Math.max(imgW, imgH) / 1024) : 0;

      const canvas = document.createElement("canvas");
      canvas.width = imgW + bw * 2;
      canvas.height = imgH + bw * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) { toast.error("Canvas not supported"); return; }

      if (borderColor) {
        ctx.fillStyle = borderColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (choice.mode === "color") {
        ctx.fillStyle = choice.color;
        ctx.fillRect(bw, bw, imgW, imgH);
      } else if (choice.mode === "image" && choice.image) {
        const bg = await loadImg(choice.image);
        const scale = Math.max(imgW / bg.naturalWidth, imgH / bg.naturalHeight);
        const w = bg.naturalWidth * scale;
        const h = bg.naturalHeight * scale;
        ctx.drawImage(bg, bw + (imgW - w) / 2, bw + (imgH - h) / 2, w, h);
      }

      ctx.drawImage(base, bw, bw);

      const blob: Blob = await new Promise((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          mime,
          outputFormat === "webp" ? 0.95 : undefined
        );
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sallulabs-bg-removed.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Download error:", err);
      const a = document.createElement("a");
      a.href = resultImage;
      a.download = `sallulabs-bg-removed.${ext}`;
      a.click();
    }
  };

  const handleDownload = () => {
    void compositeAndDownload();
  };

  const formatMs = (ms: number) =>
    ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Load client-side ONNX processor (non-blocking) */}
      <Script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js" strategy="afterInteractive" />
      <Script src="/static/client-processor-v2.js" strategy="afterInteractive" />

      {/* Hidden file input for new image */}
      <input
        ref={newImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleNewImage}
      />

      {/* ── TOP BAR ── */}
      <header className="h-14 glass border-b border-[var(--glass-border)] flex items-center px-2.5 sm:px-4 gap-2 sm:gap-3 shrink-0 z-20 relative">
        <button onClick={() => router.push("/")}
          aria-label="Back home"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft size={16} />
        </button>

        {/* Logo - hidden on mobile to save header space */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <Image
            src="/logo.png"
            alt="BG Remover Logo"
            width={32}
            height={32}
            className="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(220,177,92,0.3)]"
          />
          <div className="flex items-center gap-1">
            <span className="font-bold text-foreground text-base tracking-tight">BG Remover</span>
            <span className="text-[10px] font-semibold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full border border-primary/30">FREE</span>
          </div>
        </div>

        {/* Mode tabs - desktop only */}
        <div className="hidden md:flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-[var(--glass-border)] ml-2">
          <button onClick={() => setActiveTab("single")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all
              ${activeTab === "single" ? "btn-gradient text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <ImagePlus size={12} /> Single
          </button>
          <button
            onClick={() => setActiveTab("bulk")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all
              ${activeTab === "bulk" ? "btn-gradient text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <Layers size={12} /> Bulk
          </button>
        </div>

        <div className="flex-1" />

        <ModelSelector isAuthenticated={isAuthenticated} />

        <div className="flex-1" />

        {/* Right actions - desktop */}
        {uploadedImage && (
          <button onClick={handleRemoveImage}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full glass border border-red-500/20 text-xs font-medium text-red-500/70 hover:text-red-500 hover:border-red-500/40 transition-all">
            <X size={13} /> Clear
          </button>
        )}
        <button onClick={() => newImageInputRef.current?.click()}
          className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full glass border border-[var(--glass-border)] text-xs font-medium text-muted-foreground hover:text-foreground transition-all">
          <ImagePlus size={13} /> New image
        </button>

        <button onClick={handleDownload} disabled={!resultImage}
          className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full btn-gradient text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0">
          <Download size={13} />
          <span className="hidden sm:inline">Export</span>
        </button>

        {mounted && (
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground shrink-0">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        )}

        <UserMenu />

        {/* Mobile menu trigger */}
        <button onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label="More options"
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground shrink-0">
          <MoreVertical size={16} />
        </button>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute right-2 top-full mt-1 w-52 glass border border-[var(--glass-border)] rounded-2xl p-2 z-50 shadow-2xl"
            >
              <div className="md:hidden flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-[var(--glass-border)] mb-1.5">
                <button onClick={() => { setActiveTab("single"); setMobileMenuOpen(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${activeTab === "single" ? "btn-gradient text-black" : "text-muted-foreground"}`}>
                  <ImagePlus size={12} /> Single
                </button>
                <button onClick={() => { setActiveTab("bulk"); setMobileMenuOpen(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${activeTab === "bulk" ? "btn-gradient text-black" : "text-muted-foreground"}`}>
                  <Layers size={12} /> Bulk
                </button>
              </div>
              <button onClick={() => newImageInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all">
                <ImagePlus size={14} /> New image
              </button>
              {uploadedImage && (
                <button onClick={handleRemoveImage}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500/80 hover:text-red-500 hover:bg-red-500/10 transition-all">
                  <X size={14} /> Clear image
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 overflow-auto p-3 sm:p-4" onClick={() => mobileMenuOpen && setMobileMenuOpen(false)}>
        <AnimatePresence mode="wait">

          {/* ── BULK TAB ── */}
          {activeTab === "bulk" ? (
            <motion.div key="bulk"
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex items-start sm:items-center justify-center pt-4 sm:pt-0">
              <BulkUploader />
            </motion.div>
          ) : processing ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="h-full flex items-center justify-center">
              <LoadingState model={selectedModel} context="bg" modelDownloadPct={modelDownloadPct ?? undefined} />
            </motion.div>

          ) : resultImage && uploadedImage ? (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col gap-3 sm:gap-4 max-w-4xl mx-auto w-full">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base lg:text-lg font-semibold text-foreground">Result</h2>
                  <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-emerald-600 font-medium">
                    <CheckCircle2 size={11} /> <span className="hidden sm:inline">Background removed</span><span className="sm:hidden">Done</span>
                  </span>
                  {processingMs !== null && (
                    <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
                      <Clock size={10} /> {formatMs(processingMs)}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 sm:gap-2 items-center">
                  {/* Quality selector */}
                  <div className="flex items-center gap-0.5 p-0.5 glass rounded-full border border-[var(--glass-border)]">
                    <button onClick={() => setDownloadQuality("standard")}
                      className={`px-2 py-1 rounded-full text-[10px] sm:text-[11px] font-medium transition-all ${downloadQuality === "standard" ? "btn-gradient text-black" : "text-muted-foreground hover:text-foreground"}`}
                      title="Processed size — smaller file, faster">
                      Standard
                    </button>
                    <button onClick={() => setDownloadQuality("full")}
                      className={`px-2 py-1 rounded-full text-[10px] sm:text-[11px] font-medium transition-all ${downloadQuality === "full" ? "btn-gradient text-black" : "text-muted-foreground hover:text-foreground"}`}
                      title="Original resolution — full detail (HD)">
                      Full HD
                    </button>
                  </div>
                  <button onClick={() => { setResultImage(null); setProcessingMs(null); }}
                    className="px-2.5 sm:px-3 py-1.5 rounded-full glass border border-[var(--glass-border)] text-[11px] sm:text-sm text-muted-foreground hover:text-foreground transition-all">
                    Compare
                  </button>
                  <button onClick={() => setCropOpen(true)}
                    className="px-2.5 sm:px-3 py-1.5 rounded-full glass border border-[var(--glass-border)] text-[11px] sm:text-sm text-muted-foreground hover:text-foreground transition-all">
                    Crop
                  </button>
                  <button onClick={handleDownload}
                    className="px-3 sm:px-4 py-1.5 rounded-full btn-gradient text-black text-[11px] sm:text-sm font-medium flex items-center gap-1.5">
                    <Download size={12} /> Download
                  </button>
                </div>
              </div>

              <FinalEditor
                ref={finalEditorRef}
                before={uploadedImage}
                after={resultImage}
                onBgChange={setBgChoice}
              />

              {/* Border controls */}
              <div className="glass rounded-2xl border border-[var(--glass-border)] p-3 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs sm:text-sm font-medium text-foreground">Border</span>
                  {borderColor && (
                    <button onClick={() => setBorderColor(null)}
                      className="text-[10px] sm:text-xs text-muted-foreground hover:text-foreground transition-all">
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <button onClick={() => setBorderColor(null)}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] transition-all ${!borderColor ? "border-primary text-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-foreground/50"}`}
                    title="No border">
                    <X size={10} />
                  </button>
                  {BORDER_PRESETS.map((p) => (
                    <button key={p.color} onClick={() => setBorderColor(p.color)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${borderColor === p.color ? "border-primary scale-110" : "border-muted-foreground/30 hover:border-foreground/50"}`}
                      style={{ backgroundColor: p.color }}
                      title={p.label} />
                  ))}
                </div>
                {borderColor && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">Width</span>
                    <input type="range" min={5} max={100} step={1} value={borderWidth}
                      onChange={(e) => setBorderWidth(Number(e.target.value))}
                      className="flex-1 accent-amber-500" />
                    <span className="text-[10px] sm:text-xs text-muted-foreground w-8 text-right">{borderWidth}</span>
                  </div>
                )}
              </div>

              <p className="text-[10px] sm:text-xs text-muted-foreground text-center px-2">
                Drag the slider to compare before & after. Use the controls below to add a background or border.
              </p>
            </motion.div>

          ) : !uploadedImage ? (
            <motion.div key="upload" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="h-full flex items-center justify-center">
              <div className="text-center max-w-md mx-auto px-5 py-8 sm:px-6 sm:py-10 glass rounded-3xl border border-[var(--glass-border)] w-full">
                <div className="w-16 h-16 sm:w-20 sm:h-20 btn-gradient rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-5">
                  <ImagePlus size={28} className="text-black sm:hidden" />
                  <ImagePlus size={32} className="text-black hidden sm:block" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">Upload an Image</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Select an image to remove its background and get a transparent PNG.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button onClick={() => newImageInputRef.current?.click()}
                    className="btn-gradient text-black font-semibold text-sm px-6 py-3 rounded-full inline-flex items-center gap-2 w-full sm:w-auto justify-center">
                    <ImagePlus size={16} /> Choose Image
                  </button>
                  <span className="text-xs text-muted-foreground hidden sm:inline">or</span>
                  <div className="flex items-center gap-2 px-4 py-2.5 sm:py-3 rounded-full glass border border-[var(--glass-border)] text-xs sm:text-sm text-muted-foreground w-full sm:w-auto justify-center">
                    <Clipboard size={14} /> Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground text-xs font-mono font-bold">Ctrl+V</kbd> to paste
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col gap-3 sm:gap-4 max-w-4xl mx-auto w-full">

              {/* Image preview */}
              <div className="relative rounded-2xl overflow-hidden glass border border-[var(--glass-border)] bg-muted/20 flex items-center justify-center min-h-[35vh] sm:min-h-[40vh] p-3 sm:p-4">
                <img src={uploadedImage} alt="uploaded" className="max-h-[50vh] sm:max-h-[55vh] w-auto object-contain rounded-xl" />

                {/* Toggle: transparent PNG vs WEBP */}
                <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 flex items-center gap-1 p-1 glass rounded-xl border border-[var(--glass-border)]">
                  <button
                    onClick={() => setOutputFormat("png")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-medium transition-all
                      ${outputFormat === "png" ? "btn-gradient text-black" : "text-muted-foreground hover:text-foreground"}`}>
                    PNG
                  </button>
                  <button
                    onClick={() => setOutputFormat("webp")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-medium transition-all
                      ${outputFormat === "webp" ? "btn-gradient text-black" : "text-muted-foreground hover:text-foreground"}`}>
                    WEBP
                  </button>
                </div>
              </div>

              {/* Bottom bar: actions */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* Mode status hint - hidden on smallest screens */}
                <span className="hidden lg:block text-xs text-muted-foreground">
                  {selectedModel === "pro"
                    ? (clientProReady ? "Pro — on-device AI (no server needed)" : "Pro — higher quality (server until model downloads)")
                    : (clientFastReady ? "Fast — on-device AI (instant)" : "Fast — downloading on-device models…")}
                </span>

                <button
                  onClick={handleProcess}
                  className="flex-1 sm:flex-none sm:ml-auto flex items-center justify-center gap-2 px-5 sm:px-8 py-3 rounded-full btn-gradient text-black font-bold text-sm sm:text-base shadow-lg"
                  style={{ boxShadow: "0 4px 24px rgba(220,177,92,0.45)" }}
                >
                  <Wand2 size={16} className="sm:hidden" />
                  <Wand2 size={18} className="hidden sm:block" />
                  <span>Remove Background</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* ── CROP MODAL ── */}
      <CropModal
        imageUrl={resultImage || ""}
        open={cropOpen}
        onClose={() => setCropOpen(false)}
        onCropDone={handleCropDone}
      />
    </div>
  );
}
