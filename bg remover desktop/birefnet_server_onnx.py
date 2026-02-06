#!/usr/bin/env python3
"""
Persistent BiRefNet server using ONNX Runtime for FAST loading
~3-5x faster startup than PyTorch version
"""
import sys
import os

# Suppress warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['ONNXRUNTIME_DISABLE_SPAM_WARNING'] = '1'

import json
import base64
import io
import time
from PIL import Image
import numpy as np

# Add parent dir
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class BiRefNetONNXServer:
    def __init__(self):
        self.session = None
        self.input_name = None
        self.output_name = None
        self.load_model()
    
    def load_model(self):
        """Load ONNX model - much faster than PyTorch"""
        try:
            import onnxruntime as ort
            
            sys.stderr.write("Loading AI model (ONNX Runtime)...\n")
            sys.stderr.flush()
            load_start = time.time()
            
            # Find ONNX model
            onnx_path = os.path.join(os.path.dirname(__file__), 'birefnet_lite.onnx')
            if not os.path.exists(onnx_path):
                raise FileNotFoundError(f"ONNX model not found: {onnx_path}\nRun: python export_onnx.py")
            
            # Create optimized session
            sess_options = ort.SessionOptions()
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_options.intra_op_num_threads = min(os.cpu_count() or 4, 8)
            sess_options.inter_op_num_threads = 1
            
            # Load session - FAST!
            self.session = ort.InferenceSession(onnx_path, sess_options)
            
            # Get input/output names
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            
            load_time = time.time() - load_start
            sys.stderr.write(f"✅ ONNX server ready ({load_time:.1f}s)\n")
            sys.stderr.flush()
            print(json.dumps({"status": "ready", "message": "Model loaded"}), flush=True)
            
        except ImportError:
            sys.stderr.write("❌ onnxruntime not installed. Run: pip install onnxruntime\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": "onnxruntime not installed"}), flush=True)
            sys.exit(1)
        except Exception as e:
            sys.stderr.write(f"❌ Model load failed: {e}\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            sys.exit(1)
    
    def preprocess(self, image, size=320):
        """Fast preprocessing with numpy/opencv"""
        import cv2
        
        # Convert PIL to numpy
        img_np = np.array(image)
        
        # Ensure RGB
        if len(img_np.shape) == 2:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_GRAY2RGB)
        elif img_np.shape[2] == 4:
            img_np = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
        
        # Fast resize
        img_resized = cv2.resize(img_np, (size, size), interpolation=cv2.INTER_LINEAR)
        
        # Normalize (ImageNet stats)
        img_float = img_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_norm = (img_float - mean) / std
        
        # HWC -> CHW -> NCHW
        tensor = img_norm.transpose(2, 0, 1)[np.newaxis, ...]
        return tensor.astype(np.float32)
    
    def process_image(self, input_path, hd_mode=False):
        """Process a single image with ONNX"""
        try:
            import cv2
            
            if not os.path.exists(input_path):
                return {"success": False, "error": f"File not found: {input_path}"}
            
            # Load image
            input_image = Image.open(input_path).convert('RGB')
            original_size = input_image.size
            
            # Select size based on mode
            input_size = 512 if hd_mode else 320
            mode_name = "HD" if hd_mode else "Speed"
            
            start_time = time.time()
            
            # Preprocess
            input_tensor = self.preprocess(input_image, input_size)
            
            # Inference
            infer_start = time.time()
            output = self.session.run([self.output_name], {self.input_name: input_tensor})[0]
            infer_time = time.time() - infer_start
            
            # Post-process mask
            mask = output[0, 0]  # First batch, first channel
            
            # Resize mask to original size
            mask_resized = cv2.resize((mask * 255).astype(np.uint8), original_size, 
                                       interpolation=cv2.INTER_LINEAR)
            
            # Smooth mask
            mask_resized = cv2.GaussianBlur(mask_resized, (5, 5), 0)
            
            # Apply mask to original image
            image_np = np.array(input_image)
            result = np.dstack([image_np, mask_resized])
            result_image = Image.fromarray(result, 'RGBA')
            
            # Save to base64
            img_io = io.BytesIO()
            result_image.save(img_io, 'WEBP', quality=95, method=4, lossless=True)
            img_io.seek(0)
            
            total_time = time.time() - start_time
            
            return {
                "success": True,
                "data": base64.b64encode(img_io.read()).decode('utf-8'),
                "format": "webp",
                "time": round(total_time, 2)
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def run(self):
        """Main loop - read commands from stdin"""
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                cmd = json.loads(line.strip())
                action = cmd.get("action")
                
                if action == "process":
                    result = self.process_image(
                        cmd.get("path"),
                        cmd.get("hd_mode", False)
                    )
                    print(json.dumps(result), flush=True)
                
                elif action == "ping":
                    print(json.dumps({"status": "pong"}), flush=True)
                
                elif action == "exit":
                    print(json.dumps({"status": "exiting"}), flush=True)
                    break
                    
            except json.JSONDecodeError:
                print(json.dumps({"success": False, "error": "Invalid JSON"}), flush=True)
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == '__main__':
    server = BiRefNetONNXServer()
    server.run()
