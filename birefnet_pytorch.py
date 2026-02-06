# birefnet_pytorch.py
# ULTRA-OPTIMIZED PyTorch backend for BiRefNet-Lite
# Maximum CPU speed with CV2 preprocessing and optimized threading

import os
# Set CPU threading env before importing torch
_cpu_threads = os.cpu_count() or 4
os.environ.setdefault("OMP_NUM_THREADS", str(min(_cpu_threads, 8)))
os.environ.setdefault("MKL_NUM_THREADS", str(min(_cpu_threads, 8)))
os.environ.setdefault("NUMEXPR_NUM_THREADS", str(min(_cpu_threads, 8)))

import torch
import torch.nn.functional as F
from PIL import Image
import numpy as np
import cv2
import logging
import gc
import time

logger = logging.getLogger(__name__)

class BiRefNetPyTorch:
    """
    Ultra-optimized PyTorch BiRefNet-Lite for FAST CPU inference
    
    Key optimizations:
    - Small input size (320x320) for 3x faster inference
    - CV2 preprocessing (faster than PIL/torchvision)
    - Optimal CPU threading
    - Memory-efficient inference
    """
    
    _model = None
    _device = None
    _input_size = 512
    
    # Dual mode: Speed (320) vs HD (512)
    SPEED_SIZE = 320   # ~3-4s on CPU
    HD_SIZE = 512      # ~8-9s on CPU, much better detail
    
    def __init__(self):
        self._initialize_model()
    
    def _initialize_model(self):
        """Initialize PyTorch model with maximum CPU optimizations"""
        try:
            # CPU optimizations - use all cores efficiently
            cpu_count = os.cpu_count() or 4
            optimal_threads = min(cpu_count, 8)  # Cap at 8 for efficiency
            
            torch.set_num_threads(optimal_threads)
            torch.set_num_interop_threads(1)
            torch.backends.mkldnn.enabled = True
            
            # Disable gradient computation globally
            torch.set_grad_enabled(False)
            
            # Auto-detect device
            if torch.cuda.is_available():
                self._device = torch.device('cuda')
                self._input_size = 512  # GPU can handle larger
                logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
                torch.backends.cudnn.benchmark = True
            else:
                self._device = torch.device('cpu')
                self._input_size = 512  # 512 for quality on CPU (accept 6-7s instead of 3s)
                logger.info(f"Using CPU with {optimal_threads} threads (input: {self._input_size}x{self._input_size})")
            
            # Load model
            from transformers import AutoModelForImageSegmentation
            
            logger.info("Loading BiRefNet-Lite model...")
            self._model = AutoModelForImageSegmentation.from_pretrained(
                'ZhengPeng7/BiRefNet_lite',
                trust_remote_code=True
            )
            
            self._model.to(self._device)
            self._model.eval()
            
            # GPU: use FP16 for speed
            if self._device.type == 'cuda':
                self._model = self._model.half()
                logger.info("Enabled FP16 for GPU")
            
            # Warmup BOTH resolutions for instant switching
            logger.info("Warming up model (both Speed & HD modes)...")
            for size in [self.SPEED_SIZE, self.HD_SIZE]:
                dummy = torch.randn(1, 3, size, size, device=self._device)
                if self._device.type == 'cuda':
                    dummy = dummy.half()
                with torch.inference_mode():
                    _ = self._model(dummy)
            
            logger.info(f"BiRefNet-Lite ready! Speed: {self.SPEED_SIZE}px | HD: {self.HD_SIZE}px")
            
        except Exception as e:
            logger.error(f"Failed to initialize model: {e}")
            raise
    
    def _preprocess_cv2(self, image, input_size):
        """Ultra-fast preprocessing with OpenCV"""
        # Convert PIL to numpy
        img_np = np.array(image)
        
        # Ensure RGB
        if len(img_np.shape) == 2:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_GRAY2RGB)
        elif img_np.shape[2] == 4:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
        
        # Fast resize with CV2
        img_resized = cv2.resize(img_np, (input_size, input_size), 
                                  interpolation=cv2.INTER_LINEAR)
        
        # Normalize (ImageNet stats) - vectorized for speed
        img_float = img_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_norm = (img_float - mean) / std
        
        # HWC -> CHW -> NCHW
        tensor = torch.from_numpy(img_norm.transpose(2, 0, 1)).unsqueeze(0)
        
        return tensor.to(self._device)
    
    @torch.inference_mode()
    def remove_background(self, image, return_mask=False, post_process=True, hd_mode=False):
        """Remove background - Speed mode (~3-4s) or HD mode (~8-9s)"""
        try:
            start_time = time.time()
            original_size = image.size
            
            # Select resolution based on mode
            input_size = self.HD_SIZE if hd_mode else self.SPEED_SIZE
            mode_name = "HD" if hd_mode else "Speed"
            
            # Ensure RGB
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Fast CV2 preprocessing
            input_tensor = self._preprocess_cv2(image, input_size)
            
            if self._device.type == 'cuda':
                input_tensor = input_tensor.half()
            
            # Inference
            infer_start = time.time()
            output = self._model(input_tensor)[-1]
            infer_time = time.time() - infer_start
            
            # Get mask and resize to original
            mask = torch.sigmoid(output[0, 0])
            mask = F.interpolate(
                mask.unsqueeze(0).unsqueeze(0),
                size=original_size[::-1],
                mode='bilinear',
                align_corners=False
            ).squeeze()
            
            # Convert to numpy
            mask_np = (mask.cpu().numpy() * 255).astype(np.uint8)
            
            # REFINE MASK: Close gaps, smooth edges (optional)
            if post_process:
                kernel = np.ones((5,5), np.uint8)
                mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, kernel)  # Close gaps
                mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_OPEN, kernel)   # Remove noise
                mask_np = cv2.GaussianBlur(mask_np, (5,5), 0)  # Smooth edges
            
            # Apply mask
            image_np = np.array(image)
            result = np.dstack([image_np, mask_np])
            result_image = Image.fromarray(result, 'RGBA')
            
            total_time = time.time() - start_time
            logger.info(f"[{mode_name} {input_size}px] Inference: {infer_time:.2f}s, Total: {total_time:.2f}s")
            
            if return_mask:
                return result_image, Image.fromarray(mask_np, 'L')
            
            return result_image
            
        except Exception as e:
            logger.error(f"Background removal failed: {e}")
            raise
    
    def get_device_info(self):
        """Get device information"""
        info = {
            'device': str(self._device),
            'model_loaded': self._model is not None,
            'input_size': f"{self._input_size}x{self._input_size}",
            'threads': torch.get_num_threads()
        }
        
        if self._device.type == 'cuda':
            info['gpu_name'] = torch.cuda.get_device_name(0)
            info['gpu_memory'] = f"{torch.cuda.memory_allocated(0) / 1024**3:.2f} GB"
        
        return info
    
    def clear_cache(self):
        """Clear cache"""
        if self._device.type == 'cuda':
            torch.cuda.empty_cache()
        gc.collect()
        logger.info("Cache cleared")
