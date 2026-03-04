"""
Background Remover v4 - Smart Model Routing
============================================
Uses face detection to route:
  - Persons → RVM (Robust Video Matting) - fast=0.2, pro=0.5 downsample
  - Objects → RMBG-1.4 (general segmentation)

Models are singletons - loaded once, stay in memory.
"""
import os
import logging
import numpy as np
import cv2
from PIL import Image
import time
import gc
import threading

logger = logging.getLogger(__name__)

# ── Singleton state ──────────────────────────────────────────────────────────
_rvm_session = None
_rmbg_session = None
_face_cascade = None
_rvm_lock = threading.Lock()
_rmbg_lock = threading.Lock()
_face_lock = threading.Lock()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Model URLs and paths ─────────────────────────────────────────────────────
RVM_CONFIG = {
    'name': 'RVM (Robust Video Matting)',
    'url': 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
    'file': os.path.join(BASE_DIR, 'rvm.onnx'),
    'size_mb': 15,
}

RMBG_CONFIG = {
    'name': 'RMBG-1.4',
    'url': 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
    'file': os.path.join(BASE_DIR, 'rmbg14.onnx'),
    'size_mb': 40,
    'input_size': 1024,
}

# ── Fast Face Detection (optimized OpenCV) ──────────────────────────────────

_face_cascade = None

def _get_face_cascade():
    global _face_cascade
    if _face_cascade is not None:
        return _face_cascade
    with _face_lock:
        if _face_cascade is not None:
            return _face_cascade
        _face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        logger.info("Face detection cascade loaded")
    return _face_cascade


def detect_person(image: Image.Image) -> bool:
    """
    Fast face detection to determine if image contains a person.
    Returns True if face detected, False otherwise.
    Optimized to run in <100ms.
    """
    t0 = time.time()
    cascade = _get_face_cascade()
    
    # Convert to grayscale numpy array
    img_np = np.array(image.convert('RGB'))
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    
    # Resize to max 320px for very fast detection
    h, w = gray.shape
    max_size = 320
    scale = min(max_size / max(h, w), 1.0)
    if scale < 1.0:
        new_w = int(w * scale)
        new_h = int(h * scale)
        gray = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    
    # Detect faces with optimized parameters for speed
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.2,  # Larger steps = faster
        minNeighbors=3,   # Lower = faster but less accurate
        minSize=(20, 20), # Smaller min = catch more faces
        flags=cv2.CASCADE_SCALE_IMAGE
    )
    
    is_person = len(faces) > 0
    elapsed = time.time() - t0
    logger.info(f"Face detection: {'person' if is_person else 'object'} ({elapsed:.3f}s, {len(faces)} faces)")
    return is_person


# ── Download helper ──────────────────────────────────────────────────────────

def _download_model(url: str, path: str, name: str):
    """Download model file if not exists"""
    if os.path.exists(path):
        return True
    
    import urllib.request
    logger.info(f"Downloading {name} from {url}...")
    try:
        urllib.request.urlretrieve(url, path)
        logger.info(f"Downloaded {name}: {os.path.getsize(path)/1e6:.1f} MB")
        return True
    except Exception as e:
        logger.error(f"Failed to download {name}: {e}")
        return False


# ── RVM Model (Robust Video Matting) ─────────────────────────────────────────

def _get_rvm_session():
    global _rvm_session
    if _rvm_session is not None:
        return _rvm_session
    with _rvm_lock:
        if _rvm_session is not None:
            return _rvm_session
        
        # Download if needed
        if not _download_model(RVM_CONFIG['url'], RVM_CONFIG['file'], 'RVM'):
            raise RuntimeError("Failed to download RVM model")
        
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1
        
        t0 = time.time()
        session = ort.InferenceSession(RVM_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"RVM loaded in {time.time()-t0:.2f}s")
        _rvm_session = session
    return _rvm_session


def run_rvm(image: Image.Image, downsample_ratio: float = 0.5) -> Image.Image:
    """
    Run RVM (Robust Video Matting) for person segmentation.
    downsample_ratio: 0.2 = fast, 0.5 = pro quality
    """
    session = _get_rvm_session()
    W, H = image.size
    
    # Prepare inputs
    src = np.array(image.convert("RGB"), dtype=np.float32) / 255.0
    src = src.transpose(2, 0, 1)[np.newaxis, ...]  # (1, 3, H, W)
    
    # RVM recurrent states (zeros for single image)
    r = np.zeros((1, 1, 1, 1), dtype=np.float32)
    dsr = np.array([downsample_ratio], dtype=np.float32)
    
    t0 = time.time()
    outputs = session.run(None, {
        "src": src,
        "r1i": r, "r2i": r, "r3i": r, "r4i": r,
        "downsample_ratio": dsr
    })
    
    # Output: fgr (foreground), pha (alpha)
    pha = outputs[1]  # Alpha channel
    logger.info(f"RVM inference ({downsample_ratio}): {time.time()-t0:.2f}s")
    
    # Extract mask and resize
    mask = (pha[0, 0] * 255).clip(0, 255).astype(np.uint8)
    mask = Image.fromarray(mask).resize((W, H), Image.BILINEAR)
    
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


# ── RMBG-1.4 Model (General Objects) ─────────────────────────────────────────

def _get_rmbg_session():
    global _rmbg_session
    if _rmbg_session is not None:
        return _rmbg_session
    with _rmbg_lock:
        if _rmbg_session is not None:
            return _rmbg_session
        
        # Download if needed
        if not _download_model(RMBG_CONFIG['url'], RMBG_CONFIG['file'], 'RMBG-1.4'):
            raise RuntimeError("Failed to download RMBG-1.4 model")
        
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1
        
        t0 = time.time()
        session = ort.InferenceSession(RMBG_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"RMBG-1.4 loaded in {time.time()-t0:.2f}s")
        _rmbg_session = session
    return _rmbg_session


def run_rmbg(image: Image.Image) -> Image.Image:
    """
    Run RMBG-1.4 for general object segmentation.
    Works on everything: products, animals, objects, etc.
    """
    session = _get_rmbg_session()
    W, H = image.size
    size = RMBG_CONFIG['input_size']
    
    # Preprocess
    x = image.convert("RGB").resize((size, size), Image.BILINEAR)
    x = np.array(x, dtype=np.float32) / 255.0
    x = (x - 0.5)  # RMBG normalization
    x = x.transpose(2, 0, 1)[np.newaxis, ...]
    
    t0 = time.time()
    out = session.run(None, {session.get_inputs()[0].name: x})[0]
    logger.info(f"RMBG inference: {time.time()-t0:.2f}s")
    
    # Extract and normalize mask
    mask = out[0, 0]
    mask = (mask - mask.min()) / (mask.max() - mask.min() + 1e-8)
    mask = (mask * 255).clip(0, 255).astype(np.uint8)
    mask = Image.fromarray(mask).resize((W, H), Image.BILINEAR)
    
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


# ── Public API ───────────────────────────────────────────────────────────────

class BackgroundRemoverV4:
    """
    Smart background remover with automatic person/object detection.
    
    Modes:
      - fast: RVM 0.2 (persons) or RMBG 1.4 (objects)
      - pro:  RVM 0.5 (persons) or RMBG 1.4 (objects)
    """
    
    def get_available_models(self):
        rvm_size = os.path.getsize(RVM_CONFIG['file']) / (1024*1024) if os.path.exists(RVM_CONFIG['file']) else RVM_CONFIG['size_mb']
        rmbg_size = os.path.getsize(RMBG_CONFIG['file']) / (1024*1024) if os.path.exists(RMBG_CONFIG['file']) else RMBG_CONFIG['size_mb']
        return {
            'fast': {'name': 'Smart Fast', 'size_mb': rvm_size, 'description': 'RVM 0.2 (persons) / RMBG (objects)'},
            'pro':  {'name': 'Smart Pro',  'size_mb': rmbg_size, 'description': 'RVM 0.5 (persons) / RMBG (objects)'},
        }
    
    def remove_background(self, image: Image.Image, mode: str = 'fast') -> Image.Image:
        """
        Remove background with automatic model selection.
        
        1. Detect if image contains a person (face detection, <100ms)
        2. Route to appropriate model:
           - Person → RVM (0.2 for fast, 0.5 for pro)
           - Object → RMBG-1.4
        """
        t0 = time.time()
        
        # Detect person vs object
        is_person = detect_person(image)
        
        if is_person:
            # Use RVM for persons
            downsample = 0.2 if mode == 'fast' else 0.5
            result = run_rvm(image, downsample_ratio=downsample)
            model_used = f"RVM ({downsample})"
        else:
            # Use RMBG for objects
            result = run_rmbg(image)
            model_used = "RMBG-1.4"
        
        logger.info(f"[{mode}] {model_used} -> total: {time.time()-t0:.2f}s")
        return result
    
    def remove_background_forced(self, image: Image.Image, model: str, mode: str = 'fast') -> Image.Image:
        """
        Force a specific model (bypass auto-detection).
        model: 'rvm' or 'rmbg'
        """
        t0 = time.time()
        if model == 'rvm':
            downsample = 0.2 if mode == 'fast' else 0.5
            result = run_rvm(image, downsample_ratio=downsample)
        else:
            result = run_rmbg(image)
        logger.info(f"[{mode}] Forced {model} → {time.time()-t0:.2f}s")
        return result
    
    def clear_cache(self):
        gc.collect()
    
    def preload_rvm(self):
        """Pre-load RVM in background thread"""
        def _load():
            try:
                _get_rvm_session()
            except Exception as e:
                logger.error(f"RVM preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()
    
    def preload_rmbg(self):
        """Pre-load RMBG in background thread"""
        def _load():
            try:
                _get_rmbg_session()
            except Exception as e:
                logger.error(f"RMBG preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()


def get_model_manager() -> BackgroundRemoverV4:
    return BackgroundRemoverV4()
