#!/usr/bin/env python3
"""
Persistent BiRefNet server for Electron desktop app
Reads JSON commands from stdin, writes JSON results to stdout
Keeps model loaded in memory for fast repeated processing
"""
import sys
import os

# Suppress noisy tqdm progress bars and warnings BEFORE any imports
os.environ['TQDM_DISABLE'] = '1'
os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'

import json
import base64
import io
import time
from PIL import Image

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class BiRefNetServer:
    def __init__(self):
        self.model = None
        self.load_model()
    
    def load_model(self):
        """Load model once at startup"""
        try:
            sys.stderr.write("Loading AI model (cached locally)...\n")
            sys.stderr.flush()
            load_start = time.time()
            
            from birefnet_model import BiRefNetLite
            self.model = BiRefNetLite()
            
            load_time = time.time() - load_start
            sys.stderr.write(f"✅ BiRefNet server ready ({load_time:.1f}s)\n")
            sys.stderr.flush()
            print(json.dumps({"status": "ready", "message": "Model loaded"}), flush=True)
        except Exception as e:
            sys.stderr.write(f"❌ Model load failed: {e}\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            sys.exit(1)
    
    def process_image(self, input_path, hd_mode=False):
        """Process a single image"""
        try:
            if not os.path.exists(input_path):
                return {"success": False, "error": f"File not found: {input_path}"}
            
            input_image = Image.open(input_path).convert('RGB')
            
            start_time = time.time()
            output_image = self.model.remove_background(
                input_image,
                return_mask=False,
                post_process=True,
                hd_mode=hd_mode
            )
            elapsed = time.time() - start_time
            
            # Save to base64
            img_io = io.BytesIO()
            output_image.save(img_io, 'WEBP', quality=95, method=4, lossless=True)
            img_io.seek(0)
            
            return {
                "success": True,
                "data": base64.b64encode(img_io.read()).decode('utf-8'),
                "format": "webp",
                "time": round(elapsed, 2)
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
    server = BiRefNetServer()
    server.run()
