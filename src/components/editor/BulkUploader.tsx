"use client";
import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, X, Loader2, CheckCircle2, Download, Layers } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { removeBackground, type BgModel, type BgFormat } from "@/lib/api";

interface BulkItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "queued" | "processing" | "done" | "error";
  resultUrl?: string;
  resultBlob?: Blob;
  error?: string;
  processingMs?: number;
}

export default function BulkUploader() {
  const { selectedModel } = useStore();
  const [items, setItems] = useState<BulkItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: BulkItem[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name}: not an image`);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: too large (max 10MB)`);
        return;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
      });
    });
    setItems((prev) => [...prev, ...accepted].slice(0, 50));
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragging.current = false;
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const processAll = async () => {
    if (items.length === 0) {
      toast.error("Add some images first.");
      return;
    }
    setProcessing(true);

    const fingerprint = (window as { userFingerprint?: string }).userFingerprint ?? "";

    for (const it of items) {
      if (it.status === "done") continue;
      setItems((prev) =>
        prev.map((p) => (p.id === it.id ? { ...p, status: "processing", error: undefined } : p))
      );
      const start = performance.now();
      try {
        const res = await removeBackground(
          it.file,
          selectedModel as BgModel,
          "png" as BgFormat,
          fingerprint
        );
        if (!res.ok) {
          setItems((prev) =>
            prev.map((p) =>
              p.id === it.id ? { ...p, status: "error", error: res.error || "Failed" } : p
            )
          );
          continue;
        }
        const url = URL.createObjectURL(res.blob!);
        setItems((prev) =>
          prev.map((p) =>
            p.id === it.id
              ? {
                  ...p,
                  status: "done",
                  resultUrl: url,
                  resultBlob: res.blob,
                  processingMs: performance.now() - start,
                }
              : p
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((p) =>
            p.id === it.id
              ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed" }
              : p
          )
        );
      }
    }

    setProcessing(false);
    toast.success("All images processed");
  };

  const downloadOne = (it: BulkItem) => {
    if (!it.resultUrl) return;
    const a = document.createElement("a");
    a.href = it.resultUrl;
    const baseName = it.file.name.replace(/\.[^.]+$/, "");
    a.download = `${baseName}-bg-removed.png`;
    a.click();
  };

  const downloadAll = async () => {
    const done = items.filter((i) => i.status === "done" && i.resultBlob);
    if (done.length === 0) {
      toast.error("Nothing to download yet.");
      return;
    }
    for (const it of done) {
      downloadOne(it);
      // tiny delay so the browser doesn't block
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  const clearAll = () => {
    items.forEach((i) => {
      URL.revokeObjectURL(i.previewUrl);
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setItems([]);
  };

  const queued = items.filter((i) => i.status === "queued").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <div className="flex flex-col gap-3 w-full max-w-4xl mx-auto">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onPick}
      />

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          dragging.current = true;
        }}
        onDragLeave={() => (dragging.current = false)}
        onDrop={onDrop}
        className="glass border-2 border-dashed border-[var(--glass-border)] rounded-2xl p-6 sm:p-10 text-center cursor-pointer hover:border-primary/40 transition-colors"
      >
        <div className="w-14 h-14 sm:w-16 sm:h-16 btn-gradient rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
          <Layers size={26} className="text-black sm:hidden" />
          <Layers size={30} className="text-black hidden sm:block" />
        </div>
        <h3 className="text-base sm:text-lg font-bold text-foreground mb-1">
          Drop images here or click to browse
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Up to 50 images &middot; PNG, JPG, WEBP &middot; max 10MB each
        </p>
        {items.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            {items.length} image{items.length === 1 ? "" : "s"} added
            {queued > 0 ? `, ${queued} queued` : ""}
            {doneCount > 0 ? `, ${doneCount} done` : ""}
            {errorCount > 0 ? `, ${errorCount} failed` : ""}
          </p>
        )}
      </div>

      {/* Action bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={processAll}
            disabled={processing || queued === 0}
            className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-full btn-gradient text-black text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {processing ? "Processing…" : `Process all (${queued})`}
          </button>
          <button
            onClick={downloadAll}
            disabled={doneCount === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full glass border border-[var(--glass-border)] text-sm font-medium text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Download all ({doneCount})
          </button>
          <button
            onClick={clearAll}
            disabled={processing}
            className="ml-auto flex items-center gap-1.5 px-3 py-2.5 rounded-full glass border border-red-500/20 text-xs sm:text-sm font-medium text-red-500/70 hover:text-red-500 disabled:opacity-40"
          >
            <X size={12} /> Clear
          </button>
        </div>
      )}

      {/* Item list */}
      <AnimatePresence>
        {items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-2 overflow-hidden"
          >
            {items.map((it) => (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="glass border border-[var(--glass-border)] rounded-xl p-2 flex items-center gap-2 sm:gap-3"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-muted shrink-0 border border-[var(--glass-border)]">
                  <img
                    src={it.resultUrl || it.previewUrl}
                    alt={it.file.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                    {it.file.name}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {it.status === "queued" && "Queued"}
                    {it.status === "processing" && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Loader2 size={10} className="animate-spin" /> Processing…
                      </span>
                    )}
                    {it.status === "done" && (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 size={10} /> Done
                        {it.processingMs ? ` · ${(it.processingMs / 1000).toFixed(1)}s` : ""}
                      </span>
                    )}
                    {it.status === "error" && (
                      <span className="text-red-500 truncate">{it.error}</span>
                    )}
                  </p>
                </div>
                {it.status === "done" && (
                  <button
                    onClick={() => downloadOne(it)}
                    className="w-8 h-8 flex items-center justify-center rounded-full glass border border-[var(--glass-border)] text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Download"
                  >
                    <Download size={13} />
                  </button>
                )}
                <button
                  onClick={() => removeItem(it.id)}
                  disabled={it.status === "processing"}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-red-500 shrink-0 disabled:opacity-30"
                  aria-label="Remove"
                >
                  <X size={13} />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
