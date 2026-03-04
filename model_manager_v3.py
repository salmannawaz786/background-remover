"""
Background Remover - 2 Mode System
  fast: U2Net Silueta (ONNX, 320px) - instant, server always
  pro:  BiRefNet-lite (PyTorch .pt, 512px) - high quality, auth-only

Models are singletons - loaded once, stay in memory for all users.
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
_fast_session = None       # ONNX session for Silueta
_pro_model = None          # PyTorch BiRefNet model
_pro_device = None
_pro_lock = threading.Lock()
_fast_lock = threading.Lock()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Config ───────────────────────────────────────────────────────────────────
FAST_CONFIG = {
    'name': 'U2Net Silueta',
    'file': os.path.join(BASE_DIR, 'silueta.onnx'),
    'input_size': 320,
    'input_name': 'input.1',
    'output_index': 0,
}

PRO_CONFIG = {
    'name': 'BiRefNet-lite',
    'pt_file': os.path.join(BASE_DIR, 'birefnet_lite_traced.pt'),
    'hf_model': 'ZhengPeng7/BiRefNet_lite',
    'input_size': 512,
}

# ImageNet normalization constants
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)


# ── Fast model (Silueta ONNX) ────────────────────────────────────────────────

def _get_fast_session():
    global _fast_session
    if _fast_session is not None:
        return _fast_session
    with _fast_lock:
        if _fast_session is not None:
            return _fast_session
        import onnxruntime as ort
        num_cores = os.cpu_count() or 4
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 2   # Silueta optimal at 2 threads
        opts.inter_op_num_threads = 1
        opts.enable_cpu_mem_arena = True
        opts.enable_mem_pattern = True

        # Use cached optimized graph if available
        cache_dir = os.path.join(BASE_DIR, '.onnx_cache')
        os.makedirs(cache_dir, exist_ok=True)
        opt_path = os.path.join(cache_dir, 'opt_silueta.onnx')

        t0 = time.time()
        if os.path.exists(opt_path):
            session = ort.InferenceSession(opt_path, sess_options=opts, providers=['CPUExecutionProvider'])
        else:
            opts.optimized_model_filepath = opt_path
            session = ort.InferenceSession(FAST_CONFIG['file'], sess_options=opts, providers=['CPUExecutionProvider'])
        logger.info(f"Silueta ONNX loaded in {time.time()-t0:.2f}s")
        _fast_session = session
    return _fast_session


def _run_fast(image: Image.Image) -> Image.Image:
    """Run Silueta ONNX - U2Net foreground/background segmentation"""
    session = _get_fast_session()
    size = FAST_CONFIG['input_size']
    original_size = image.size  # (W, H)

    # Preprocess
    img = np.array(image.convert('RGB'), dtype=np.float32)
    img = cv2.resize(img, (size, size), interpolation=cv2.INTER_LINEAR)
    img = img / 255.0
    # Simple 0-1 normalization for Silueta
    tensor = np.ascontiguousarray(img.transpose(2, 0, 1)[np.newaxis])

    # Inference
    outputs = session.run(None, {FAST_CONFIG['input_name']: tensor})
    mask = outputs[FAST_CONFIG['output_index']]

    # Extract mask
    if len(mask.shape) == 4:
        mask = mask[0, 0]
    elif len(mask.shape) == 3:
        mask = mask[0]

    # Resize back and normalize
    mask = cv2.resize(mask.astype(np.float32), original_size, interpolation=cv2.INTER_LINEAR)
    mn, mx = mask.min(), mask.max()
    if mx - mn > 1e-6:
        mask = (mask - mn) / (mx - mn)
    else:
        mask = np.zeros_like(mask)

    alpha = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    result = image.convert('RGBA')
    result.putalpha(Image.fromarray(alpha, 'L'))
    return result


# ── Pro model (BiRefNet .pt) ─────────────────────────────────────────────────

def _get_pro_model():
    """Load BiRefNet PyTorch model - stays in memory as singleton"""
    global _pro_model, _pro_device
    if _pro_model is not None:
        return _pro_model, _pro_device
    with _pro_lock:
        if _pro_model is not None:
            return _pro_model, _pro_device

        import torch
        import torch.nn.functional as F

        # Threading
        num_cores = os.cpu_count() or 4
        torch.set_num_threads(min(num_cores, 8))
        torch.set_num_interop_threads(1)
        torch.backends.mkldnn.enabled = True
        torch.set_grad_enabled(False)

        # Device
        if torch.cuda.is_available():
            device = torch.device('cuda')
            logger.info(f"BiRefNet using GPU: {torch.cuda.get_device_name(0)}")
        else:
            device = torch.device('cpu')
            logger.info(f"BiRefNet using CPU ({min(num_cores,8)} threads)")

        t0 = time.time()

        # Load from HuggingFace local cache (cached after first download, ~instant on repeat)
        logger.info("Loading BiRefNet-lite from HuggingFace local cache...")
        model = _load_hf_model(device)

        # GPU FP16
        if device.type == 'cuda':
            model = model.half()
            logger.info("BiRefNet FP16 enabled for GPU")

        # Warmup
        logger.info("Warming up BiRefNet (512px)...")
        dummy = torch.randn(1, 3, 512, 512, device=device)
        if device.type == 'cuda':
            dummy = dummy.half()
        with torch.inference_mode():
            _ = model(dummy)
        del dummy
        gc.collect()

        logger.info(f"BiRefNet-lite ready! ({time.time()-t0:.2f}s total)")
        _pro_model = model
        _pro_device = device

    return _pro_model, _pro_device


def _load_hf_model(device):
    """Load from HuggingFace with local cache"""
    from transformers import AutoModelForImageSegmentation
    cache_dir = os.path.join(BASE_DIR, '.model_cache')
    os.makedirs(cache_dir, exist_ok=True)
    try:
        model = AutoModelForImageSegmentation.from_pretrained(
            PRO_CONFIG['hf_model'],
            trust_remote_code=True,
            cache_dir=cache_dir,
            local_files_only=True
        )
        logger.info("Loaded BiRefNet from local HuggingFace cache")
    except Exception:
        logger.info("Downloading BiRefNet from HuggingFace (first run)...")
        model = AutoModelForImageSegmentation.from_pretrained(
            PRO_CONFIG['hf_model'],
            trust_remote_code=True,
            cache_dir=cache_dir
        )
    model.to(device).eval()
    return model


def _run_pro(image: Image.Image) -> Image.Image:
    """Run BiRefNet PyTorch at 512px - high quality"""
    import torch
    import torch.nn.functional as F

    model, device = _get_pro_model()
    size = PRO_CONFIG['input_size']
    original_size = image.size  # (W, H)

    # CV2 preprocessing (fast)
    img_np = np.array(image.convert('RGB'), dtype=np.float32)
    img_np = cv2.resize(img_np, (size, size), interpolation=cv2.INTER_LINEAR)
    img_np = img_np / 255.0
    img_np = (img_np - _MEAN) / _STD
    tensor = torch.from_numpy(img_np.transpose(2, 0, 1)).unsqueeze(0).to(device)
    if device.type == 'cuda':
        tensor = tensor.half()

    # Inference
    t0 = time.time()
    with torch.inference_mode():
        output = model(tensor)
        # Handle both TorchScript list output and HuggingFace tuple output
        if isinstance(output, (list, tuple)):
            raw = output[-1]
        else:
            raw = output

    mask = torch.sigmoid(raw[0, 0])
    mask = F.interpolate(
        mask.unsqueeze(0).unsqueeze(0),
        size=(original_size[1], original_size[0]),  # H, W
        mode='bilinear',
        align_corners=False
    ).squeeze()

    mask_np = (mask.cpu().float().numpy() * 255).astype(np.uint8)
    logger.info(f"BiRefNet inference: {time.time()-t0:.2f}s ({original_size[0]}x{original_size[1]})")

    # Morphological refinement
    kernel = np.ones((5, 5), np.uint8)
    mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, kernel)
    mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_OPEN, kernel)
    mask_np = cv2.GaussianBlur(mask_np, (5, 5), 0)

    result = image.convert('RGBA')
    result.putalpha(Image.fromarray(mask_np, 'L'))
    return result


# ── Public API ───────────────────────────────────────────────────────────────

class BackgroundRemoverV2:
    """2-mode background remover. Call remove_background(image, mode='fast'|'pro')"""

    def get_available_models(self):
        fast_size = os.path.getsize(FAST_CONFIG['file']) / (1024*1024) if os.path.exists(FAST_CONFIG['file']) else 0
        pro_size  = os.path.getsize(PRO_CONFIG['pt_file']) / (1024*1024) if os.path.exists(PRO_CONFIG['pt_file']) else 0
        return {
            'fast': {'name': 'U2Net Silueta', 'size_mb': fast_size, 'description': 'Fast (~3s)'},
            'pro':  {'name': 'BiRefNet-lite', 'size_mb': pro_size,  'description': 'Pro quality (~8s)'},
        }

    def remove_background(self, image: Image.Image, mode: str = 'fast') -> Image.Image:
        t0 = time.time()
        if mode == 'pro':
            result = _run_pro(image)
        else:
            result = _run_fast(image)
        logger.info(f"[{mode}] Total: {time.time()-t0:.2f}s")
        return result

    def clear_cache(self):
        gc.collect()

    def preload_pro(self):
        """Pre-load the pro model in a background thread so first user doesn't wait"""
        def _load():
            try:
                _get_pro_model()
            except Exception as e:
                logger.error(f"Pro model preload failed: {e}")
        t = threading.Thread(target=_load, daemon=True)
        t.start()


def get_model_manager() -> BackgroundRemoverV2:
    return BackgroundRemoverV2()
