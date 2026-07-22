"use client";
import { useState, useCallback } from "react";
import Cropper, { Area } from "react-easy-crop";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export interface CropArea { x: number; y: number; width: number; height: number }

interface CropModalProps {
  imageUrl: string;
  open: boolean;
  onClose: () => void;
  onCropDone: (area: CropArea) => void;
}

export async function cropImageToBlob(imageSrc: string, area: CropArea): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = area.width;
      canvas.height = area.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")), "image/png");
    };
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageSrc;
  });
}

export default function CropModal({ imageUrl, open, onClose, onCropDone }: CropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = () => {
    if (!croppedAreaPixels) return;
    onCropDone(croppedAreaPixels as CropArea);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-full max-w-3xl glass rounded-3xl border border-[var(--glass-border)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]">
              <h3 className="text-sm font-semibold text-foreground">Crop Image</h3>
              <button onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground">
                <X size={15} />
              </button>
            </div>

            <div className="relative w-full h-[50vh] bg-black/40">
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={undefined}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--glass-border)]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Zoom:</span>
                <input type="range" min={1} max={3} step={0.1} value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-24 accent-amber-500" />
              </div>
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="px-4 py-2 rounded-full glass border border-[var(--glass-border)] text-xs font-medium text-muted-foreground hover:text-foreground transition-all">
                  Cancel
                </button>
                <button onClick={handleSave}
                  className="px-5 py-2 rounded-full btn-gradient text-black text-xs font-bold transition-all">
                  Apply Crop
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
