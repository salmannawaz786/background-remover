#!/usr/bin/env python3
"""
SalluLabs Watermark Remover - Python Backend (v2 – Optimized)
Maximum speed + quality inpainting with GPU/CPU auto-detection.
"""

# ──────────────────────────────────────────────────────────────
# Advanced CPU optimizations – MUST be set before any torch import
# Forces the CPU to use every available core for parallel ops
# ──────────────────────────────────────────────────────────────
import os, sys, multiprocessing

_CPU_COUNT = str(multiprocessing.cpu_count())
os.environ.setdefault("OMP_NUM_THREADS", _CPU_COUNT)
os.environ.setdefault("MKL_NUM_THREADS", _CPU_COUNT)
os.environ.setdefault("OPENBLAS_NUM_THREADS", _CPU_COUNT)
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", _CPU_COUNT)
os.environ.setdefault("NUMEXPR_NUM_THREADS", _CPU_COUNT)
# Disable NNPACK (unreliable on some CPUs, slows down)
os.environ.setdefault("ATEN_THREADING", "OMP")

import argparse
import traceback
import time
import json
import glob

# ──────────────────────────────────────────────────────────────
# Progress reporting for Electron IPC
# ──────────────────────────────────────────────────────────────
def emit(tag, value):
    """Print structured message for Electron to capture (Windows-safe)."""
    msg = f"{tag}:{value}"
    # On Windows the default stdout encoding (charmap/cp1252) can't handle
    # some Unicode chars, which causes a crash.  Encode safely.
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode('ascii', 'replace').decode('ascii'), flush=True)

def print_progress(percent):
    emit("PROGRESS", int(percent))

def print_status(msg):
    emit("STATUS", msg)

# ──────────────────────────────────────────────────────────────
# Device setup – CUDA > MPS > DirectML > CPU
# ──────────────────────────────────────────────────────────────
_DEVICE_CACHE = {}

def setup_device(preference="auto"):
    """Return (torch_device_str, use_half_precision)."""
    import torch

    if preference in _DEVICE_CACHE:
        return _DEVICE_CACHE[preference]

    use_half = False

    if preference != "cpu":
        # 1) NVIDIA CUDA
        if preference in ("auto", "cuda") and torch.cuda.is_available():
            dev = "cuda"
            name = torch.cuda.get_device_name()
            print_status(f"GPU: {name}")
            # Enable TF32 for Ampere+ (huge speed boost, negligible quality loss)
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
            use_half = True  # FP16 on GPU
            _DEVICE_CACHE[preference] = (dev, use_half)
            return dev, use_half

        # 2) Apple MPS
        if preference in ("auto", "mps"):
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                dev = "mps"
                print_status("GPU: Apple Silicon MPS")
                _DEVICE_CACHE[preference] = (dev, False)  # MPS fp16 can be unstable
                return dev, False

        # 3) DirectML (AMD / Intel Arc on Windows)
        if preference in ("auto", "directml"):
            try:
                import torch_directml
                dev = torch_directml.device()
                print_status("GPU: DirectML (AMD/Intel)")
                _DEVICE_CACHE[preference] = (str(dev), False)
                return str(dev), False
            except ImportError:
                pass

    # 4) CPU fallback – squeeze every drop of performance
    dev = "cpu"
    print_status(f"CPU: {_CPU_COUNT} threads")
    # Use channels-last memory format hint for CPU (faster convolutions)
    _DEVICE_CACHE[preference] = (dev, False)
    return dev, False

# ──────────────────────────────────────────────────────────────
# Model loading with warmup & JIT optimization
# ──────────────────────────────────────────────────────────────
_MODEL_CACHE = {}

def load_lama_model(model_path, device, use_half=False):
    """Load + cache + warmup the LaMa JIT model."""
    import torch

    cache_key = f"{model_path}:{device}"
    if cache_key in _MODEL_CACHE:
        return _MODEL_CACHE[cache_key]

    if not os.path.exists(model_path):
        print_status(f"Model not found: {model_path}")
        return None

    try:
        print_status("Loading Ai model...")
        t0 = time.perf_counter()
        model = torch.jit.load(model_path, map_location=device)
        model.eval()

        if use_half and device == "cuda":
            model = model.half()

        # Warmup pass – primes JIT, allocates CUDA memory, benchmarks cuDNN
        print_status("Warming up model...")
        dummy_img = torch.zeros(1, 3, 64, 64, device=device)
        dummy_msk = torch.zeros(1, 1, 64, 64, device=device)
        if use_half and device == "cuda":
            dummy_img = dummy_img.half()
            dummy_msk = dummy_msk.half()
        with torch.inference_mode():
            try:
                model(dummy_img, dummy_msk)
            except Exception:
                model(torch.cat([dummy_img, dummy_msk], dim=1))
        if device == "cuda":
            torch.cuda.synchronize()

        dt = time.perf_counter() - t0
        print_status(f"Model ready ({dt:.1f}s)")
        _MODEL_CACHE[cache_key] = model
        return model
    except Exception as e:
        print_status(f"Model load failed: {e}")
        return None

# ──────────────────────────────────────────────────────────────
# Smart mask processing – handles humans, text, and objects
# ──────────────────────────────────────────────────────────────
def process_mask(mask, image_shape, content_hint="auto"):
    """
    Advanced mask processing.
    - Detects mask region size to decide dilation (larger = likely human).
    - Uses adaptive dilation to ensure clean edges around people.
    """
    import cv2
    import numpy as np

    # Convert to single-channel binary mask
    if len(mask.shape) == 3:
        channels = [
            mask[:, :, 2],  # Red (BGR)
            mask[:, :, 1],  # Green
            mask[:, :, 0],  # Blue
            cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY),
        ]
        best, best_n = None, 0
        for ch in channels:
            _, bm = cv2.threshold(ch, 30, 255, cv2.THRESH_BINARY)
            n = np.count_nonzero(bm)
            pct = n / bm.size * 100
            if 0.05 < pct < 85 and n > best_n:
                best_n, best = n, bm
        if best is None:
            gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
            _, best = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        mask = best
    else:
        _, mask = cv2.threshold(mask, 30, 255, cv2.THRESH_BINARY)

    # Morphological cleanup
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3)   # remove noise
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k5)  # fill holes

    # Adaptive dilation – bigger masks (humans/large objects) get more dilation
    mask_pct = np.count_nonzero(mask) / mask.size * 100
    img_diag = int(np.hypot(*image_shape[:2]))

    if mask_pct > 8:
        # Large region (human, big object) – generous dilation for seamless edges
        dil = max(11, int(img_diag * 0.025))
    elif mask_pct > 2:
        # Medium region
        dil = max(7, int(img_diag * 0.018))
    else:
        # Small region (text, watermark)
        dil = max(5, int(img_diag * 0.012))

    if dil % 2 == 0:
        dil += 1
    kd = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dil, dil))
    mask = cv2.dilate(mask, kd, iterations=1)

    # For human-sized masks, apply Gaussian blur to feather edges
    if mask_pct > 5:
        blur_k = max(3, dil // 2)
        if blur_k % 2 == 0:
            blur_k += 1
        mask = cv2.GaussianBlur(mask, (blur_k, blur_k), 0)
        _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

    return mask

# ──────────────────────────────────────────────────────────────
# LaMa inference – "Downscale-Inpaint-Upscale" speed pipeline
# with Smart Crop + Masked Overlay for maximum speed & quality
# ──────────────────────────────────────────────────────────────
LAMA_PROCESS_SIZE_GPU = 800   # GPU: higher quality, still fast
LAMA_PROCESS_SIZE_CPU = 512   # CPU: ~2.4x faster than 800
CROP_PAD_RATIO    = 0.25  # 25 % padding around mask bounding box
CROP_PAD_MIN_PX   = 64    # Minimum padding in pixels

def _get_mask_bbox(mask, pad_ratio=CROP_PAD_RATIO, pad_min=CROP_PAD_MIN_PX):
    """Return padded (y1, y2, x1, x2) bounding box of non-zero mask pixels."""
    import numpy as np
    rows = np.any(mask > 0, axis=1)
    cols = np.any(mask > 0, axis=0)
    if not rows.any():
        return 0, mask.shape[0], 0, mask.shape[1]
    y1, y2 = np.where(rows)[0][[0, -1]]
    x1, x2 = np.where(cols)[0][[0, -1]]
    bh, bw = y2 - y1, x2 - x1
    pad_y = max(pad_min, int(bh * pad_ratio))
    pad_x = max(pad_min, int(bw * pad_ratio))
    y1 = max(0, y1 - pad_y)
    y2 = min(mask.shape[0], y2 + pad_y)
    x1 = max(0, x1 - pad_x)
    x2 = min(mask.shape[1], x2 + pad_x)
    return int(y1), int(y2), int(x1), int(x2)

def _run_lama_tensor(model, image_bgr, mask_gray, device, use_half):
    """Run the LaMa model on an image+mask pair. Returns BGR uint8 result."""
    import torch
    import torch.nn.functional as F
    import numpy as np
    import cv2

    img_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    msk_f = mask_gray.astype(np.float32) / 255.0

    img_t = torch.from_numpy(img_rgb).permute(2, 0, 1).unsqueeze(0)
    msk_t = torch.from_numpy(msk_f).unsqueeze(0).unsqueeze(0)

    img_t = img_t.to(device)
    msk_t = msk_t.to(device)
    if use_half and device == "cuda":
        img_t = img_t.half()
        msk_t = msk_t.half()

    # Pad to mod-8
    h, w = img_t.shape[-2:]
    pad_h = (8 - h % 8) % 8
    pad_w = (8 - w % 8) % 8
    if pad_h or pad_w:
        img_t = F.pad(img_t, (0, pad_w, 0, pad_h), mode="reflect")
        msk_t = F.pad(msk_t, (0, pad_w, 0, pad_h), mode="reflect")

    with torch.inference_mode():
        try:
            result = model(img_t, msk_t)
        except Exception:
            result = model(torch.cat([img_t, msk_t], dim=1))

    if isinstance(result, (tuple, list)):
        result = result[0]
    if pad_h or pad_w:
        result = result[:, :, :h, :w]

    result = result.float().squeeze(0).permute(1, 2, 0).cpu().numpy()
    result = np.clip(result * 255, 0, 255).astype(np.uint8)
    return cv2.cvtColor(result, cv2.COLOR_RGB2BGR)


def inpaint_with_lama(model, image, mask, device, use_half=False):
    """
    Pro-grade "Downscale-Inpaint-Upscale" pipeline:

    1. Smart Crop – extract the mask's bounding box + padding from the
       original high-res image (avoids wasting compute on untouched pixels).
    2. Internal Resize – shrink that crop to process size max-side
       so the AI runs in ~1-2 s instead of 5-10 s.
    3. Run LaMa on the tiny crop.
    4. Upscale the result back to the original crop size with INTER_LANCZOS4.
    5. Masked Overlay – paste *only* the inpainted pixels onto the original
       full-res image via a feathered blend mask.  The rest of the image
       stays at 100 % original quality.
    """
    import cv2
    import numpy as np

    # Pick process size based on device (CPU needs smaller for speed)
    proc_size = LAMA_PROCESS_SIZE_CPU if device == 'cpu' else LAMA_PROCESS_SIZE_GPU

    orig_h, orig_w = image.shape[:2]

    # ── Step 1: Smart Crop around the mask ──────────────────────
    y1, y2, x1, x2 = _get_mask_bbox(mask)
    crop_img  = image[y1:y2, x1:x2].copy()
    crop_mask = mask[y1:y2, x1:x2].copy()
    crop_h, crop_w = crop_img.shape[:2]

    # ── Step 2: Internal resize for AI speed ────────────────────
    max_side = max(crop_h, crop_w)
    needs_resize = max_side > proc_size
    if needs_resize:
        scale = proc_size / max_side
        proc_w = max(8, int(crop_w * scale))
        proc_h = max(8, int(crop_h * scale))
        proc_img  = cv2.resize(crop_img,  (proc_w, proc_h), interpolation=cv2.INTER_AREA)
        proc_mask = cv2.resize(crop_mask, (proc_w, proc_h), interpolation=cv2.INTER_NEAREST)
    else:
        proc_img  = crop_img
        proc_mask = crop_mask

    # ── Step 3: Run LaMa on the small crop ──────────────────────
    result_small = _run_lama_tensor(model, proc_img, proc_mask, device, use_half)

    # ── Step 4: Upscale back to original crop size ──────────────
    if needs_resize:
        result_crop = cv2.resize(result_small, (crop_w, crop_h),
                                 interpolation=cv2.INTER_LANCZOS4)
    else:
        result_crop = result_small

    # ── Step 5: Masked Overlay onto original image ──────────────
    # Build a feathered 3-channel blend mask for seamless edges
    blend_mask = crop_mask.astype(np.float32) / 255.0
    blur_k = max(3, int(np.hypot(crop_h, crop_w) * 0.008))
    if blur_k % 2 == 0:
        blur_k += 1
    blend_mask = cv2.GaussianBlur(blend_mask, (blur_k, blur_k), 0)
    blend_3c = cv2.merge([blend_mask, blend_mask, blend_mask])

    # Composite: inpainted pixels replace original only inside the mask
    blended_crop = (result_crop.astype(np.float32) * blend_3c +
                    crop_img.astype(np.float32) * (1.0 - blend_3c))
    blended_crop = np.clip(blended_crop, 0, 255).astype(np.uint8)

    # Paste the blended crop back into the full-res original
    output = image.copy()
    output[y1:y2, x1:x2] = blended_crop
    return output

# ──────────────────────────────────────────────────────────────
# OpenCV fallback – improved quality
# ──────────────────────────────────────────────────────────────
def inpaint_with_opencv(image, mask):
    """Enhanced OpenCV inpainting fallback."""
    import cv2
    import numpy as np

    # Use larger inpaint radius for better results, TELEA for speed
    diag = int(np.hypot(*image.shape[:2]))
    radius = max(3, min(15, diag // 200))
    result = cv2.inpaint(image, mask, radius, cv2.INPAINT_TELEA)
    return result

# ──────────────────────────────────────────────────────────────
# Single image processing pipeline
# ──────────────────────────────────────────────────────────────
def process_single(image_path, mask_path, output_path, model_path, device_pref,
                   quality=97, progress_offset=0, progress_range=100):
    """Process one image. Returns True on success."""
    import cv2
    import numpy as np

    def prog(pct):
        print_progress(progress_offset + pct * progress_range / 100)

    prog(5)
    print_status("Loading image...")

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        print(f"Error: Failed to load image: {image_path}", file=sys.stderr, flush=True)
        return False

    mask = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
    if mask is None:
        print(f"Error: Failed to load mask: {mask_path}", file=sys.stderr, flush=True)
        return False

    prog(10)

    # Process mask
    mask_processed = process_mask(mask, image.shape)

    if np.count_nonzero(mask_processed) == 0:
        print_status("Empty mask - saving original")
        _save_image(image, output_path, quality)
        prog(100)
        return True

    # Resize mask to match image
    if image.shape[:2] != mask_processed.shape[:2]:
        mask_processed = cv2.resize(mask_processed, (image.shape[1], image.shape[0]),
                                    interpolation=cv2.INTER_NEAREST)
    prog(15)

    # Try LaMa
    result = None
    try:
        import torch
        device, use_half = setup_device(device_pref)
        prog(20)

        if model_path and os.path.exists(model_path):
            model = load_lama_model(model_path, device, use_half)
            if model is not None:
                prog(30)
                print_status("AI is removing selected areas...")
                t0 = time.perf_counter()
                result = inpaint_with_lama(model, image, mask_processed, device, use_half)
                dt = time.perf_counter() - t0
                print_status(f"AI done in {dt:.1f}s")
        else:
            print_status("AI model not found - using fallback")
    except ImportError:
        print_status("Using fallback engine...")
    except Exception as e:
        print_status(f"AI failed: {e}")
        traceback.print_exc()

    prog(85)

    if result is None:
        print_status("Removing with fallback engine...")
        result = inpaint_with_opencv(image, mask_processed)

    prog(95)

    # Save at high quality
    _save_image(result, output_path, quality)
    prog(100)
    print_status("Done!")
    return True

def _save_image(image, path, quality=97):
    """Save image preserving quality. PNG for .png, high-quality JPEG otherwise."""
    import cv2

    ext = os.path.splitext(path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        cv2.imwrite(path, image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    elif ext == ".webp":
        cv2.imwrite(path, image, [cv2.IMWRITE_WEBP_QUALITY, quality])
    else:
        # PNG – lossless, compression level 1 (fastest)
        cv2.imwrite(path, image, [cv2.IMWRITE_PNG_COMPRESSION, 1])

# ──────────────────────────────────────────────────────────────
# Batch processing
# ──────────────────────────────────────────────────────────────
def process_batch(manifest_path, model_path, device_pref, quality=97):
    """
    Process a batch from a JSON manifest file.
    Manifest format: [{"image": path, "mask": path, "output": path}, ...]
    """
    with open(manifest_path, "r") as f:
        items = json.load(f)

    total = len(items)
    if total == 0:
        print_status("No items in batch")
        return

    print_status(f"Batch: {total} images")

    # Pre-load model once
    try:
        import torch
        device, use_half = setup_device(device_pref)
        if model_path and os.path.exists(model_path):
            load_lama_model(model_path, device, use_half)
    except ImportError:
        pass

    for i, item in enumerate(items):
        per_item = 100 / total
        offset = i * per_item
        emit("BATCH_INDEX", i)
        print_status(f"[{i+1}/{total}] {os.path.basename(item['image'])}")
        ok = process_single(
            item["image"], item["mask"], item["output"],
            model_path, device_pref, quality,
            progress_offset=offset, progress_range=per_item
        )
        emit("BATCH_ITEM_DONE", json.dumps({"index": i, "success": ok, "output": item["output"]}))

    emit("BATCH_COMPLETE", total)

# ──────────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────────
def preload_model(model_path, device_pref):
    """Pre-load and warm up the LaMa model so subsequent runs are instant."""
    try:
        import torch
        print_status("Preloading AI engine...")
        device, use_half = setup_device(device_pref)
        if model_path and os.path.exists(model_path):
            model = load_lama_model(model_path, device, use_half)
            if model is not None:
                emit("MODEL_READY", "ok")
                return
        print_status("Model file not found")
        emit("MODEL_READY", "fallback")
    except ImportError:
        print_status("PyTorch not installed")
        emit("MODEL_READY", "fallback")
    except Exception as e:
        print_status(f"Preload error: {e}")
        emit("MODEL_READY", "fallback")


def main():
    parser = argparse.ArgumentParser(description="SalluLabs Watermark Remover v2")
    parser.add_argument("--image", help="Input image path (single mode)")
    parser.add_argument("--mask", help="Mask image path (single mode)")
    parser.add_argument("--output", help="Output image path (single mode)")
    parser.add_argument("--model", default=None, help="LaMa model path (.pt)")
    parser.add_argument("--device", default="auto",
                        choices=["auto", "cuda", "mps", "directml", "cpu"])
    parser.add_argument("--quality", type=int, default=97,
                        help="Output JPEG quality 1-100 (default 97)")
    parser.add_argument("--batch", default=None,
                        help="Path to JSON batch manifest file")
    parser.add_argument("--preload", action="store_true",
                        help="Pre-load model and exit (for startup warmup)")

    args = parser.parse_args()

    if args.preload:
        preload_model(args.model, args.device)
    elif args.batch:
        process_batch(args.batch, args.model, args.device, args.quality)
    elif args.image and args.mask and args.output:
        ok = process_single(args.image, args.mask, args.output,
                            args.model, args.device, args.quality)
        if not ok:
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
