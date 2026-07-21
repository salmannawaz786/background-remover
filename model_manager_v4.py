"""
Background Remover v4 - Smart Model Routing
============================================
Fast mode:
  - Persons → RVM (Robust Video Matting)
  - Objects → U2Net-P (4MB lightweight)
Pro mode:
  - Server fallback → BREFNet Lite ONNX (model_fp16.onnx, 98MB)
  - Client-side (PC) → BREFNet Lite ONNX
  - Client-side (Mobile) → RMBG-1.4

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
_u2netp_session = None
_brefnet_session = None
_rvm_lock = threading.Lock()
_u2netp_lock = threading.Lock()
_brefnet_lock = threading.Lock()
_face_lock = threading.Lock()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Model paths ──────────────────────────────────────────────────────────────
RVM_CONFIG = {
    'name': 'RVM (Robust Video Matting)',
    'url': 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
    'file': os.path.join(BASE_DIR, 'rvm.onnx'),
    'size_mb': 15,
}

U2NETP_CONFIG = {
    'name': 'U2Net-P (fast objects)',
    'url': 'https://huggingface.co/datasets/salmannawaz786/models/resolve/main/opt_u2netp.onnx',
    'file': os.path.join(BASE_DIR, '.onnx_cache', 'opt_u2netp.onnx'),
    'input_size': 320,
    'input_name': 'input.1',
    'output_index': 0,
    'size_mb': 4,
}

BREFNET_CONFIG = {
    'name': 'BREFNet Lite ONNX (pro)',
    'file': os.path.join(BASE_DIR, 'model_fp16.onnx'),
    'input_name': 'input_image',
    'output_name': 'output_image',
    'input_size': 512,
    'size_mb': 98,
}

# ImageNet normalization constants
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# ── Multi-Stage Person Detection ─────────────────────────────────────────────

_face_cascade = None
_upperbody_cascade = None
_fullbody_cascade = None


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


def _get_upperbody_cascade():
    global _upperbody_cascade
    if _upperbody_cascade is not None:
        return _upperbody_cascade
    with _face_lock:
        if _upperbody_cascade is not None:
            return _upperbody_cascade
        _upperbody_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_upperbody.xml')
        logger.info("Upper body detection cascade loaded")
    return _upperbody_cascade


def _get_fullbody_cascade():
    global _fullbody_cascade
    if _fullbody_cascade is not None:
        return _fullbody_cascade
    with _face_lock:
        if _fullbody_cascade is not None:
            return _fullbody_cascade
        _fullbody_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_fullbody.xml')
        logger.info("Full body detection cascade loaded")
    return _fullbody_cascade


def detect_person(image: Image.Image) -> bool:
    """Multi-stage person detection using Haar cascades."""
    t0 = time.time()
    img_np = np.array(image.convert('RGB'))
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)

    h, w = gray.shape
    max_size = 600
    scale = min(max_size / max(h, w), 1.0)
    if scale < 1.0:
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR)

    face_cascade = _get_face_cascade()
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(24, 24), flags=cv2.CASCADE_SCALE_IMAGE)
    if len(faces) > 0:
        logger.info(f"[OK] PERSON detected: {len(faces)} face(s) ({time.time()-t0:.3f}s)")
        return True

    upperbody_cascade = _get_upperbody_cascade()
    upperbodies = upperbody_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 40), flags=cv2.CASCADE_SCALE_IMAGE)
    if len(upperbodies) > 0:
        logger.info(f"[OK] PERSON detected: {len(upperbodies)} upper body(ies) ({time.time()-t0:.3f}s)")
        return True

    fullbody_cascade = _get_fullbody_cascade()
    fullbodies = fullbody_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=2, minSize=(60, 60), flags=cv2.CASCADE_SCALE_IMAGE)
    if len(fullbodies) > 0:
        logger.info(f"[OK] PERSON detected: {len(fullbodies)} full body(ies) ({time.time()-t0:.3f}s)")
        return True

    logger.info(f"[NO] OBJECT detected ({time.time()-t0:.3f}s)")
    return False


# ── Download helper ──────────────────────────────────────────────────────────

def _download_model(url: str, path: str, name: str):
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
        if not _download_model(RVM_CONFIG['url'], RVM_CONFIG['file'], 'RVM'):
            raise RuntimeError("Failed to download RVM model")
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # 2 (not 4): the server runs real concurrent lanes now, so each session
        # must leave room for other sessions running on the same 2-core box.
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        t0 = time.time()
        session = ort.InferenceSession(RVM_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"RVM loaded in {time.time()-t0:.2f}s")
        _rvm_session = session
    return _rvm_session


def _refine_mask(mask: np.ndarray) -> np.ndarray:
    """Post-process alpha mask: remove specks, fill holes, feather edges."""
    mask = np.ascontiguousarray(mask)
    inv = 255 - mask
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    if num_labels > 1:
        h, w = mask.shape
        min_area = max(40, int(0.0005 * h * w))
        for i in range(1, num_labels):
            if stats[i, cv2.CC_STAT_AREA] < min_area:
                mask[labels == i] = 255
    close_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_k, iterations=1)
    mask = cv2.GaussianBlur(mask, (3, 3), 0)
    mask = np.clip(mask, 0, 255).astype(np.uint8)
    return mask


def run_rvm(image: Image.Image, downsample_ratio: float = 1.0) -> Image.Image:
    """Run RVM for person segmentation at 512px."""
    session = _get_rvm_session()
    W, H = image.size
    target_size = 512
    pil_proc = image.convert("RGB").resize((target_size, target_size), Image.BILINEAR)
    arr = np.array(pil_proc, dtype=np.float32) / 255.0
    src = (arr - _MEAN) / _STD
    src = src.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)

    r1i = np.zeros((1, 16, target_size // 2, target_size // 2), dtype=np.float32)
    r2i = np.zeros((1, 20, target_size // 4, target_size // 4), dtype=np.float32)
    r3i = np.zeros((1, 40, target_size // 8, target_size // 8), dtype=np.float32)
    r4i = np.zeros((1, 64, target_size // 16, target_size // 16), dtype=np.float32)
    dsr = np.array([1.0], dtype=np.float32)

    t0 = time.time()
    outputs = session.run(None, {"src": src, "r1i": r1i, "r2i": r2i, "r3i": r3i, "r4i": r4i, "downsample_ratio": dsr})
    pha = outputs[1]
    logger.info(f"RVM inference ({target_size}x{target_size}): {time.time()-t0:.2f}s")

    mask = pha[0, 0]
    mask = (mask - mask.min()) / (mask.max() - mask.min() + 1e-8)
    mask = (mask * 255).clip(0, 255).astype(np.uint8)
    mask = cv2.resize(mask, (W, H), interpolation=cv2.INTER_CUBIC)

    result = image.convert("RGBA")
    result.putalpha(Image.fromarray(mask, "L"))
    return result


# ── U2Net-P Model (Fast Object Segmentation, 4MB) ───────────────────────────

def _get_u2netp_session():
    global _u2netp_session
    if _u2netp_session is not None:
        return _u2netp_session
    with _u2netp_lock:
        if _u2netp_session is not None:
            return _u2netp_session
        if not _download_model(U2NETP_CONFIG['url'], U2NETP_CONFIG['file'], 'U2Net-P'):
            raise RuntimeError("Failed to download U2Net-P model")
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        t0 = time.time()
        session = ort.InferenceSession(U2NETP_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"U2Net-P loaded in {time.time()-t0:.2f}s")
        _u2netp_session = session
    return _u2netp_session


def run_u2netp(image: Image.Image) -> Image.Image:
    """Run U2Net-P (4MB) for fast object segmentation at 320px."""
    session = _get_u2netp_session()
    W, H = image.size
    size = U2NETP_CONFIG['input_size']

    img = np.array(image.convert('RGB').resize((size, size), Image.BILINEAR), dtype=np.float32)
    img = img / 255.0
    tensor = np.ascontiguousarray(img.transpose(2, 0, 1)[np.newaxis])

    t0 = time.time()
    outputs = session.run(None, {U2NETP_CONFIG['input_name']: tensor})
    raw = outputs[U2NETP_CONFIG['output_index']]
    logger.info(f"U2Net-P inference ({size}x{size}): {time.time()-t0:.2f}s")

    if len(raw.shape) == 4:
        mask = raw[0, 0]
    elif len(raw.shape) == 3:
        mask = raw[0]
    else:
        mask = raw

    mask = mask.astype(np.float32)
    mn, mx = mask.min(), mask.max()
    if mx - mn > 1e-6:
        mask = (mask - mn) / (mx - mn)
    else:
        mask = np.zeros_like(mask)

    alpha = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    alpha = cv2.resize(alpha, (W, H), interpolation=cv2.INTER_CUBIC)
    alpha = _refine_mask(alpha)

    result = image.convert("RGBA")
    result.putalpha(Image.fromarray(alpha, "L"))
    return result


# ── BREFNet Lite ONNX (Pro Quality, 98MB) ───────────────────────────────────

def _get_brefnet_session():
    global _brefnet_session
    if _brefnet_session is not None:
        return _brefnet_session
    with _brefnet_lock:
        if _brefnet_session is not None:
            return _brefnet_session
        if not os.path.exists(BREFNET_CONFIG['file']):
            raise RuntimeError(f"BREFNet model not found: {BREFNET_CONFIG['file']}")
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # 2 (not 4): the server runs real concurrent lanes now, so each session
        # must leave room for other sessions running on the same 2-core box.
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        t0 = time.time()
        session = ort.InferenceSession(BREFNET_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"BREFNet Lite ONNX loaded in {time.time()-t0:.2f}s")
        _brefnet_session = session
    return _brefnet_session


def run_brefnet(image: Image.Image) -> Image.Image:
    """Run BREFNet Lite ONNX (512px) for pro-quality segmentation."""
    session = _get_brefnet_session()
    W, H = image.size
    size = BREFNET_CONFIG['input_size']

    img = np.array(image.convert('RGB').resize((size, size), Image.BILINEAR), dtype=np.float32)
    img = img / 255.0
    img = (img - _MEAN) / _STD
    tensor = img.transpose(2, 0, 1)[np.newaxis].astype(np.float32)

    t0 = time.time()
    out = session.run(None, {BREFNET_CONFIG['input_name']: tensor})[0]
    logger.info(f"BREFNet inference ({size}x{size}): {time.time()-t0:.2f}s")

    mask = out[0, 0]
    mask = 1.0 / (1.0 + np.exp(-mask.astype(np.float32)))
    mask = (mask * 255).clip(0, 255).astype(np.uint8)
    mask = cv2.resize(mask, (W, H), interpolation=cv2.INTER_CUBIC)
    mask = _refine_mask(mask)

    result = image.convert("RGBA")
    result.putalpha(Image.fromarray(mask, "L"))
    return result


# ── Public API ───────────────────────────────────────────────────────────────

class BackgroundRemoverV4:
    """
    Smart background remover with automatic person/object detection.

    Fast mode:
      - Person → RVM (persons)
      - Object → U2Net-P (4MB, fast)
    Pro mode (server fallback):
      - All images → BREFNet Lite ONNX (98MB, high quality)
    """

    def get_available_models(self):
        rvm_size = os.path.getsize(RVM_CONFIG['file']) / (1024*1024) if os.path.exists(RVM_CONFIG['file']) else RVM_CONFIG['size_mb']
        u2netp_size = os.path.getsize(U2NETP_CONFIG['file']) / (1024*1024) if os.path.exists(U2NETP_CONFIG['file']) else U2NETP_CONFIG['size_mb']
        brefnet_size = os.path.getsize(BREFNET_CONFIG['file']) / (1024*1024) if os.path.exists(BREFNET_CONFIG['file']) else BREFNET_CONFIG['size_mb']
        return {
            'fast': {'name': 'Smart Fast', 'size_mb': rvm_size + u2netp_size, 'description': 'RVM (persons) / U2Net-P (objects)'},
            'pro':  {'name': 'Smart Pro',  'size_mb': brefnet_size, 'description': 'BREFNet Lite (all images)'},
        }

    def remove_background(self, image: Image.Image, mode: str = 'fast') -> Image.Image:
        """
        Remove background with automatic model selection.

        Fast mode:
           - Person → RVM (sharp, fast)
           - Object → U2Net-P (4MB, lightweight)
        Pro mode:
           - All images → BREFNet Lite ONNX (highest quality)
        """
        t0 = time.time()

        if mode == 'pro':
            result = run_brefnet(image)
            model_used = "BREFNet Lite"
        else:
            is_person = detect_person(image)
            if is_person:
                result = run_rvm(image)
                model_used = "RVM"
            else:
                result = run_u2netp(image)
                model_used = "U2Net-P"

        logger.info(f"[{mode}] {model_used} -> total: {time.time()-t0:.2f}s")
        return result

    def remove_background_forced(self, image: Image.Image, model: str, mode: str = 'fast') -> Image.Image:
        """Force a specific model: 'rvm', 'u2netp', or 'brefnet'."""
        t0 = time.time()
        if model == 'rvm':
            result = run_rvm(image)
        elif model == 'brefnet':
            result = run_brefnet(image)
        else:
            result = run_u2netp(image)
        logger.info(f"[{mode}] Forced {model} -> {time.time()-t0:.2f}s")
        return result

    def clear_cache(self):
        gc.collect()

    def load_rvm(self):
        """Load RVM synchronously (blocking)"""
        _get_rvm_session()

    def load_u2netp(self):
        """Load U2Net-P synchronously (blocking)"""
        _get_u2netp_session()

    def preload_rvm(self):
        """Pre-load RVM in background thread"""
        def _load():
            try:
                _get_rvm_session()
            except Exception as e:
                logger.error(f"RVM preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()

    def preload_u2netp(self):
        """Pre-load U2Net-P in background thread"""
        def _load():
            try:
                _get_u2netp_session()
            except Exception as e:
                logger.error(f"U2Net-P preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()

    def preload_brefnet(self):
        """Pre-load BREFNet in background thread"""
        def _load():
            try:
                _get_brefnet_session()
            except Exception as e:
                logger.error(f"BREFNet preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()


def get_model_manager() -> BackgroundRemoverV4:
    return BackgroundRemoverV4()
