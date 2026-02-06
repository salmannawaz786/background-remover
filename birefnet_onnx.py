# birefnet_onnx.py
# Ultra-fast ONNX Runtime inference for BiRefNet-Lite
# Provides 3-5x speedup on CPU compared to PyTorch

import numpy as np
from PIL import Image
import cv2
import logging
import os
import time
from typing import Union, Tuple

logger = logging.getLogger(__name__)

class BiRefNetONNX:
    """
    ONNX Runtime-based BiRefNet-Lite for lightning-fast CPU inference
    
    Key optimizations:
    - ONNX Runtime with graph optimizations
    - Optimized thread settings for CPU
    - CV2 for fast image preprocessing
    - Efficient numpy operations
    """
    
    _instance = None
    _session = None
    _input_size = 512
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(BiRefNetONNX, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._session is None:
            self._initialize_model()
    
    def _initialize_model(self):
        """Initialize ONNX Runtime with optimal settings"""
        import onnxruntime as ort
        
        # Check for ONNX model file
        onnx_paths = [
            'birefnet_lite_512_optimized.onnx',
            'birefnet_lite_512.onnx',
            'birefnet_lite_1024_optimized.onnx',
            'birefnet_lite_1024.onnx',
        ]
        
        onnx_path = None
        for path in onnx_paths:
            if os.path.exists(path):
                onnx_path = path
                break
        
        if onnx_path is None:
            logger.warning("No ONNX model found. Will convert from PyTorch on first use.")
            onnx_path = self._convert_to_onnx()
            if onnx_path is None:
                raise RuntimeError("Failed to create ONNX model. Run: python convert_to_onnx.py")
        
        # Determine input size from filename
        if '1024' in onnx_path:
            self._input_size = 1024
        else:
            self._input_size = 512
        
        logger.info(f"Loading ONNX model: {onnx_path} (input: {self._input_size}x{self._input_size})")
        
        # Configure ONNX Runtime for maximum CPU performance
        sess_options = ort.SessionOptions()
        
        # Graph optimizations (crucial for speed)
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        # Threading optimizations
        cpu_count = os.cpu_count() or 4
        sess_options.intra_op_num_threads = cpu_count
        sess_options.inter_op_num_threads = 2
        
        # Enable parallel execution
        sess_options.execution_mode = ort.ExecutionMode.ORT_PARALLEL
        
        # Memory optimizations
        sess_options.enable_mem_pattern = True
        sess_options.enable_cpu_mem_arena = True
        
        logger.info(f"ONNX Runtime config: {cpu_count} threads, parallel execution, all optimizations")
        
        # Create session with CPU provider
        providers = ['CPUExecutionProvider']
        
        # Check for CUDA
        if 'CUDAExecutionProvider' in ort.get_available_providers():
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
            logger.info("CUDA available - using GPU acceleration")
        
        try:
            self._session = ort.InferenceSession(
                onnx_path,
                sess_options,
                providers=providers
            )
            
            # Get input/output names
            self._input_name = self._session.get_inputs()[0].name
            self._output_name = self._session.get_outputs()[0].name
            
            # Warmup run
            logger.info("Warming up ONNX model...")
            dummy = np.random.randn(1, 3, self._input_size, self._input_size).astype(np.float32)
            _ = self._session.run([self._output_name], {self._input_name: dummy})
            
            active_provider = self._session.get_providers()[0]
            logger.info(f"ONNX Runtime initialized successfully! Provider: {active_provider}")
            
        except Exception as e:
            logger.error(f"Failed to load ONNX model: {e}")
            raise
    
    def _convert_to_onnx(self):
        """Auto-convert PyTorch model to ONNX"""
        try:
            logger.info("Auto-converting BiRefNet-Lite to ONNX...")
            
            import torch
            from transformers import AutoModelForImageSegmentation
            
            model = AutoModelForImageSegmentation.from_pretrained(
                'ZhengPeng7/BiRefNet_lite',
                trust_remote_code=True
            )
            model.eval()
            
            dummy_input = torch.randn(1, 3, 512, 512)
            output_path = 'birefnet_lite_512.onnx'
            
            with torch.no_grad():
                torch.onnx.export(
                    model,
                    dummy_input,
                    output_path,
                    input_names=['input'],
                    output_names=['output'],
                    opset_version=17,
                    do_constant_folding=True
                )
            
            logger.info(f"ONNX model saved: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Auto-conversion failed: {e}")
            return None
    
    def _preprocess(self, image: Image.Image) -> np.ndarray:
        """Fast preprocessing with CV2"""
        # Convert PIL to numpy
        img_np = np.array(image)
        
        # Convert RGB to BGR for cv2
        if len(img_np.shape) == 2:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_GRAY2RGB)
        elif img_np.shape[2] == 4:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
        
        # Resize with cv2 (much faster than PIL)
        img_resized = cv2.resize(
            img_np, 
            (self._input_size, self._input_size), 
            interpolation=cv2.INTER_LINEAR
        )
        
        # Normalize (ImageNet stats)
        img_float = img_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_normalized = (img_float - mean) / std
        
        # HWC -> CHW -> NCHW
        img_transposed = img_normalized.transpose(2, 0, 1)
        img_batch = np.expand_dims(img_transposed, axis=0)
        
        return img_batch.astype(np.float32)
    
    def _postprocess(self, output: np.ndarray, original_size: Tuple[int, int]) -> np.ndarray:
        """Fast postprocessing"""
        # Sigmoid activation
        mask = 1 / (1 + np.exp(-output[0, 0]))
        
        # Resize to original size
        mask_resized = cv2.resize(
            mask,
            original_size,
            interpolation=cv2.INTER_LINEAR
        )
        
        # Apply threshold for cleaner edges
        mask_clean = np.clip(mask_resized, 0, 1)
        
        # Optional: light morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask_uint8 = (mask_clean * 255).astype(np.uint8)
        mask_uint8 = cv2.morphologyEx(mask_uint8, cv2.MORPH_CLOSE, kernel)
        
        return mask_uint8
    
    def remove_background(
        self,
        image: Image.Image,
        return_mask: bool = False,
        post_process: bool = True
    ) -> Union[Image.Image, Tuple[Image.Image, Image.Image]]:
        """
        Remove background from image using ONNX Runtime
        
        Args:
            image: PIL Image in RGB mode
            return_mask: If True, also return the mask
            post_process: Apply post-processing for cleaner edges
            
        Returns:
            Image with transparent background (and optionally the mask)
        """
        try:
            start_time = time.time()
            original_size = image.size
            
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Preprocess
            input_tensor = self._preprocess(image)
            
            # ONNX inference
            infer_start = time.time()
            outputs = self._session.run(
                [self._output_name],
                {self._input_name: input_tensor}
            )
            infer_time = time.time() - infer_start
            
            # Postprocess
            mask = self._postprocess(outputs[0], original_size)
            
            # Create RGBA image
            image_np = np.array(image)
            result = np.dstack([image_np, mask])
            result_image = Image.fromarray(result, 'RGBA')
            
            total_time = time.time() - start_time
            logger.info(f"ONNX inference: {infer_time:.3f}s, total: {total_time:.3f}s")
            
            if return_mask:
                mask_image = Image.fromarray(mask, 'L')
                return result_image, mask_image
            
            return result_image
            
        except Exception as e:
            logger.error(f"ONNX background removal failed: {e}")
            raise
    
    def get_device_info(self) -> dict:
        """Get device information"""
        import onnxruntime as ort
        
        return {
            'device': 'ONNX Runtime',
            'model_loaded': self._session is not None,
            'input_size': f"{self._input_size}x{self._input_size}",
            'providers': self._session.get_providers() if self._session else [],
            'onnxruntime_version': ort.__version__
        }
    
    def clear_cache(self):
        """Clear any cached data"""
        import gc
        gc.collect()
        logger.info("ONNX cache cleared")


# Wrapper class that auto-selects best backend
class BiRefNetLite:
    """
    Smart wrapper that uses ONNX Runtime if available, falls back to PyTorch
    """
    
    _instance = None
    _backend = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(BiRefNetLite, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._backend is None:
            self._initialize_backend()
    
    def _initialize_backend(self):
        """Select best available backend"""
        # Try ONNX first (much faster on CPU)
        onnx_available = any(os.path.exists(p) for p in [
            'birefnet_lite_512_optimized.onnx',
            'birefnet_lite_512.onnx',
            'birefnet_lite_1024_optimized.onnx',
            'birefnet_lite_1024.onnx',
        ])
        
        if onnx_available:
            try:
                import onnxruntime
                logger.info("ONNX model found - using ONNX Runtime (3-5x faster)")
                self._backend = BiRefNetONNX()
                return
            except ImportError:
                logger.warning("onnxruntime not installed. Install with: pip install onnxruntime")
        
        # Fallback to PyTorch
        logger.info("Using PyTorch backend (slower). For faster inference, run: python convert_to_onnx.py")
        self._backend = self._create_pytorch_backend()
    
    def _create_pytorch_backend(self):
        """Create PyTorch-based backend"""
        from birefnet_pytorch import BiRefNetPyTorch
        return BiRefNetPyTorch()
    
    def remove_background(self, image, return_mask=False, post_process=True):
        return self._backend.remove_background(image, return_mask, post_process)
    
    def get_device_info(self):
        return self._backend.get_device_info()
    
    def clear_cache(self):
        self._backend.clear_cache()
