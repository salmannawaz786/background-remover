"use client";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Upload, Sparkles, ArrowRight, Layers, Download, Clock, ImageIcon, Smartphone } from "lucide-react";
import { useStore } from "@/lib/store";
import { getFirebaseApp } from "@/lib/firebase";
import { toast } from "sonner";
import { isPWA } from "@/lib/pwa-utils";

function useImageCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    async function setup() {
      try {
        const app = await getFirebaseApp();
        const { getFirestore, doc, onSnapshot } = await import("firebase/firestore");
        const db = getFirestore(app);
        // Listen to stats/global for real-time image count
        unsub = onSnapshot(doc(db, "stats", "global"), snap => {
          if (snap.exists()) {
            const imagesProcessed = snap.data()?.imagesProcessed ?? 0;
            setCount(imagesProcessed);
            console.log(`✅ Images processed updated: ${imagesProcessed}`);
          }
        }, (error) => {
          console.error('Error listening to global stats:', error);
        });
      } catch {
        setCount(null);
      }
    }
    setup();
    return () => { unsub?.(); };
  }, []);
  return count;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K+`;
  return String(n);
}

export default function Hero() {
  const router = useRouter();
  const setUploadedImage = useStore(s => s.setUploadedImage);
  const [dragging, setDragging] = useState(false);
  const imageCount = useImageCount();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [isInPWA, setIsInPWA] = useState(false);

  useEffect(() => {
    setIsInPWA(isPWA());
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      setDeferredPrompt(null);
      setShowInstall(false);
    } else {
      toast.info("To install: tap the share icon (iOS) or menu (Android/Desktop) and select 'Add to Home Screen'");
    }
  };

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImage(e.target?.result as string, file);
      router.push("/editor");
    };
    reader.readAsDataURL(file);
  }, [router, setUploadedImage]);

  // Ctrl+V / Cmd+V clipboard paste on home page
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
            setUploadedImage(ev.target?.result as string, blob);
            toast.success("Image pasted from clipboard");
            router.push("/editor");
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [router, setUploadedImage]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    maxFiles: 1,
    onDragEnter: () => setDragging(true),
    onDragLeave: () => setDragging(false),
  });

  const stats = [
    {
      icon: ImageIcon,
      val: imageCount !== null ? formatCount(imageCount) : "10K+",
      label: "Images processed",
      live: imageCount !== null,
    },
    { icon: Clock, val: "< 3s", label: "Fast mode time", live: false },
  ];

  return (
    <section className="aurora-bg min-h-screen flex flex-col items-center justify-center px-4 text-center relative pt-10 pb-16">
      {/* Background grid — golden tint */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(220,177,92,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(220,177,92,0.04)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-4xl mx-auto">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-sm text-primary font-semibold mb-7 border border-primary/30"
        >
          <Sparkles size={14} className="text-primary" />
          AI-Powered Background Removal
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08 }}
          className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tight leading-[1.1] mb-5"
        >
          Remove backgrounds{" "}
          <span className="gradient-text">instantly</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}
          className="text-base sm:text-lg lg:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
        >
          Upload your image, and our AI erases the background in seconds —
          leaving a clean, transparent PNG. No registration required for your first image.
        </motion.p>

        {/* Drop zone */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.22 }}
          className="max-w-xl mx-auto"
        >
          <div
            {...getRootProps()}
            className={`relative cursor-pointer group rounded-2xl border-2 border-dashed p-8 sm:p-10 transition-all duration-300
              ${isDragActive || dragging
                ? "border-primary bg-primary/10 scale-[1.01] shadow-[0_0_40px_rgba(251,191,36,0.2)]"
                : "border-[var(--glass-border)] hover:border-primary/60 bg-[var(--glass-bg)] hover:shadow-[0_0_30px_rgba(251,191,36,0.1)]"
              }`}
            style={{ backdropFilter: "blur(16px)" }}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300
                ${isDragActive ? "btn-gradient scale-110 shadow-[0_0_24px_rgba(251,191,36,0.5)]" : "bg-primary/10 group-hover:bg-primary/20"}`}>
                <Upload size={28} className={isDragActive ? "text-black" : "text-primary"} />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {isDragActive ? "Drop it here!" : "Drop image here or click to upload"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">PNG, JPG, WEBP up to 5MB (10MB signed in)</p>
              </div>
              <button className="btn-gradient text-black text-sm font-bold px-6 py-2.5 rounded-full flex items-center gap-2 shadow-md">
                Choose File <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {/* Bulk option + Install button */}
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            {!isInPWA && (
              <button
                onClick={handleInstall}
                className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-primary/30 text-sm font-semibold text-primary hover:bg-primary/10 transition-all"
              >
                <Smartphone size={14} /> Install App
                <span className="text-[10px] bg-primary/15 px-1.5 py-0.5 rounded-full">Free</span>
              </button>
            )}
            <button
              onClick={() => router.push("/editor")}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Layers size={12} /> Bulk Mode
              <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full border border-primary/25">Browser</span>
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}
          className="flex items-center justify-center gap-6 sm:gap-10 mt-12"
        >
          {stats.map(({ icon: Icon, val, label, live }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1.5">
                <Icon size={14} className="text-primary" />
                <span className="text-xl sm:text-2xl font-black text-foreground">{val}</span>
                {live && (
                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-500 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
