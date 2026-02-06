#!/usr/bin/env python3
"""
Persistent BiRefNet ONNX server for Electron desktop app
Loads in 2-3 seconds vs 20+ seconds for PyTorch
Reads JSON commands from stdin, writes JSON results to stdout
"""
import sys
import os
import json
import base64
import io
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import numpy as np
    from PIL import Image
    import cv2
except ImportError as e:
    logger.error(f"Missing required package: {e}")
    sys.exit(1)

class BiRefNetONNXServer:
    def __init__(self):
        self._session = None
        self._input_name = None
        self._output_name = None
        self._input_size = 512
        self.load_model()
    
    def _find_model(self):
        """Find ONNX model file"""
        model_paths = [
            'birefnet_lite_512_optimized.onnx',
            'birefnet_lite_512.onnx',
            'birefnet_lite_1024_optimized.onnx',
            'birefnet_lite_1024.onnx',
            '../birefnet_lite_512_optimized.onnx',
            '../birefnet_lite_512.onnx',
        ]
        for path in model_paths:
            if os.path.exists(path):
                return path
        return None
    
    def load_model(self):
        """Load ONNX model - 5-10x faster than PyTorch"""
        import onnxruntime as ort
        
        onnx_path = self._find_model()
        
        if onnx_path is None:
            logger.info("ONNX model not found. Converting from PyTorch (one-time)...")
            onnx_path = self._convert_model()
        
        if onnx_path is None:
            raise RuntimeError("Failed to load or create ONNX model")
        
        logger.info(f"Loading ONNX model: {os.path.basename(onnx_path)}")
        
        if '1024' in onnx_path:
            self._input_size = 1024
        
        # Fast session options
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        cpu_count = os.cpu_count() or 4
        sess_options.intra_op_num_threads = cpu_count
        sess_options.inter_op_num_threads = 2
        sess_options.execution_mode = ort.ExecutionMode.ORT_PARALLEL
        
        providers = ort.get_available_providers()
        self._session = ort.InferenceSession(onnx_path, sess_options, providers=providers)
        self._input_name = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name
        
        # Warmup for instant first inference
        dummy = np.random.randn(1, 3, self._input_size, self._input_size).astype(np.float32)
        _ = self._session.run([self._output_name], {self._input_name: dummy})
        
        logger.info(f"ONNX loaded! Provider: {self._session.get_providers()[0]}")
    
    def _convert_model(self):
        """Convert PyTorch to ONNX (one-time)"""
        try:
            import torch
            from transformers import AutoModelForImageSegmentation
            
            logger.info("Downloading model from HuggingFace...")
            model = AutoModelForImageSegmentation.from_pretrained(
                'ZhengPeng7/BiRefNet_lite', trust_remote_code=True
            )
            model.eval()
            
            dummy = torch.randn(1, 3, 512, 512)
            output_path = 'birefnet_lite_512.onnx'
            
            logger.info("Exporting to ONNX...")
            with torch.no_grad():
                torch.onnx.export(model, dummy, output_path,
                    input_names=['input'], output_names=['output'],
                    opset_version=17, do_constant_folding=True)
            
            return output_path
        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            return None
    
    def _preprocess(self, image):
        """Fast preprocessing"""
        img_np = np.array(image.convert('RGB'))
        img_resized = cv2.resize(img_np, (self._input_size, self._input_size))
        img_float = img_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406])
        std = np.array([0.229, 0.224, 0.225])
        img_norm = (img_float - mean) / std
        return np.expand_dims(img_norm.transpose(2, 0, 1), 0).astype(np.float32)
    
    def _postprocess(self, output, original_size):
        """Fast postprocessing"""
        mask = 1 / (1 + np.exp(-output[0, 0]))
        mask_resized = cv2.resize(mask, original_size)
        return (np.clip(mask_resized, 0, 1) * 255).astype(np.uint8)
    
    def process_image(self, input_path, hd_mode=False):
        """Process image with ONNX"""
        try:
            if not os.path.exists(input_path):
                return {"success": False, "error": f"File not found: {input_path}"}
            
            image = Image.open(input_path)
            original_size = image.size
            
            start_time = time.time()
            input_tensor = self._preprocess(image)
            
            infer_start = time.time()
            outputs = self._session.run([self._output_name], {self._input_name: input_tensor})
            infer_time = time.time() - infer_start
            
            mask = self._postprocess(outputs[0], original_size)
            
            # Create RGBA result
            image_rgb = np.array(image.convert('RGB'))
            result = np.dstack([image_rgb, mask])
            result_image = Image.fromarray(result, 'RGBA')
            
            # Encode
            img_io = io.BytesIO()
            result_image.save(img_io, 'WEBP', quality=90)
            
            total_time = time.time() - start_time
            
            return {
                "success": True,
                "data": base64.b64encode(img_io.getvalue()).decode('utf-8'),
                "time": round(total_time, 2),
                "inference": round(infer_time, 2)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def run(self):
        """Main loop"""
        print(json.dumps({"status": "ready"}), flush=True)
        
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                cmd = json.loads(line.strip())
                action = cmd.get("action")
                
                if action == "process":
                    result = self.process_image(cmd.get("path"), cmd.get("hd_mode", False))
                    print(json.dumps(result), flush=True)
                elif action == "ping":
                    print(json.dumps({"status": "pong"}), flush=True)
                elif action == "exit":
                    break
                    
            except json.JSONDecodeError:
                print(json.dumps({"success": False, "error": "Invalid JSON"}), flush=True)
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == '__main__':
    try:
        server = BiRefNetONNXServer()
        server.run()
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        sys.exit(1)
