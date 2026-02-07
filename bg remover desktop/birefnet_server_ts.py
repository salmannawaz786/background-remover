#!/usr/bin/env python3
"""
Persistent BiRefNet server using TorchScript for FAST loading
~3-4x faster startup than loading full PyTorch model
"""
import sys
import os

# Suppress warnings
os.environ['TQDM_DISABLE'] = '1'
os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'

import json
import base64
import io
import time
from PIL import Image
import numpy as np

# Add parent dir
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import torch
import torch.nn.functional as F

class BiRefNetTorchScriptServer:
    def __init__(self):
        self.model = None
        self.device = None
        self.load_model()
    
    def load_model(self):
        """Load TorchScript model - much faster than PyTorch"""
        try:
            import cv2
            
            sys.stderr.write("Loading AI model (TorchScript)...\n")
            sys.stderr.flush()
            load_start = time.time()
            
            # Find TorchScript model
            script_path = os.path.join(os.path.dirname(__file__), 'birefnet_lite.pt')
            if not os.path.exists(script_path):
                raise FileNotFoundError(
                    f"TorchScript model not found: {script_path}\n"
                    f"Run: python export_torchscript.py"
                )
            
            # Detect device
            if torch.cuda.is_available():
                self.device = torch.device('cuda')
                sys.stderr.write("Using GPU\n")
            else:
                self.device = torch.device('cpu')
                # Optimize CPU
                cpu_count = os.cpu_count() or 4
                torch.set_num_threads(min(cpu_count, 8))
                sys.stderr.write(f"Using CPU ({min(cpu_count, 8)} threads)\n")
            
            # Load TorchScript - FAST!
            self.model = torch.jit.load(script_path, map_location=self.device)
            self.model.to(self.device)
            self.model.eval()
            
            # Warmup
            dummy = torch.randn(1, 3, 320, 320, device=self.device)
            if self.device.type == 'cuda':
                dummy = dummy.half()
            with torch.no_grad():
                _ = self.model(dummy)
            
            load_time = time.time() - load_start
            sys.stderr.write(f"✅ TorchScript server ready ({load_time:.1f}s)\n")
            sys.stderr.flush()
            print(json.dumps({"status": "ready", "message": "Model loaded"}), flush=True)
            
        except ImportError as e:
            sys.stderr.write(f"❌ Missing dependency: {e}\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            sys.exit(1)
        except Exception as e:
            sys.stderr.write(f"❌ Model load failed: {e}\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            sys.exit(1)
    
    def _preprocess_cv2(self, image, input_size):
        """Ultra-fast preprocessing with OpenCV"""
        import cv2
        
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
        
        # Normalize (ImageNet stats)
        img_float = img_resized.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_norm = (img_float - mean) / std
        
        # HWC -> CHW -> NCHW
        tensor = torch.from_numpy(img_norm.transpose(2, 0, 1)).unsqueeze(0)
        
        return tensor.to(self.device)
    
    def process_image(self, input_path, hd_mode=False):
        """Process a single image with TorchScript"""
        try:
            import cv2
            
            if not os.path.exists(input_path):
                return {"success": False, "error": f"File not found: {input_path}"}
            
            # Load image
            input_image = Image.open(input_path).convert('RGB')
            original_size = input_image.size
            
            # Select resolution based on mode
            input_size = 512 if hd_mode else 320
            mode_name = "HD" if hd_mode else "Speed"
            
            start_time = time.time()
            
            # Preprocess
            input_tensor = self._preprocess_cv2(input_image, input_size)
            
            if self.device.type == 'cuda':
                input_tensor = input_tensor.half()
            
            # Inference
            infer_start = time.time()
            with torch.no_grad():
                output = self.model(input_tensor)
            infer_time = time.time() - infer_start
            
            # Handle output (may be tuple/list from JIT)
            if isinstance(output, (tuple, list)):
                output = output[-1]  # Take last element like original
            
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
            
            # Refine mask
            kernel = np.ones((5,5), np.uint8)
            mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, kernel)
            mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_OPEN, kernel)
            mask_np = cv2.GaussianBlur(mask_np, (5,5), 0)
            
            # Apply mask
            image_np = np.array(input_image)
            result = np.dstack([image_np, mask_np])
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
            import traceback
            error_detail = traceback.format_exc()
            sys.stderr.write(f"Processing error: {error_detail}\n")
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
    server = BiRefNetTorchScriptServer()
    server.run()
