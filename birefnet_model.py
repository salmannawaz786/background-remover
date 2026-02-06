# birefnet_model.py
# Ultra-optimized BiRefNet-Lite wrapper for fast CPU inference

import logging
import gc

logger = logging.getLogger(__name__)

class BiRefNetLite:
    """
    BiRefNet-Lite wrapper optimized for CPU speed
    
    Key optimizations:
    - 320x320 input (2.5x faster than 512x512)
    - CV2 preprocessing (faster than PIL)
    - Optimal CPU threading
    - Model warmup for JIT
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
        """Initialize optimized PyTorch backend"""
        logger.info("=" * 50)
        logger.info("Initializing BiRefNet-Lite (Optimized)")
        logger.info("=" * 50)
        
        try:
            from birefnet_pytorch import BiRefNetPyTorch
            self._backend = BiRefNetPyTorch()
            logger.info("Backend ready!")
        except Exception as e:
            logger.error(f"Failed to initialize backend: {e}")
            raise
    
    def remove_background(self, image, return_mask=False, post_process=True, hd_mode=False):
        """Remove background from image (Speed or HD mode)"""
        return self._backend.remove_background(image, return_mask, post_process, hd_mode=hd_mode)
    
    def get_device_info(self):
        """Get device information"""
        return self._backend.get_device_info()
    
    def clear_cache(self):
        """Clear cache"""
        self._backend.clear_cache()
        gc.collect()
