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
import threading
from PIL import Image

# Add parent dir to path (skip in PyInstaller frozen mode)
if not getattr(sys, 'frozen', False):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _get_cache_dir():
    """Get model cache directory (matches birefnet_pytorch.py logic)"""
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.expanduser('~'), '.sallulabs', 'model_cache')
    else:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.model_cache')


def _get_dir_size(dir_path):
    """Get total size of all files in directory tree"""
    total = 0
    for dirpath, _, filenames in os.walk(dir_path):
        for f in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total


def _is_model_cached(cache_dir):
    """Check if model.safetensors exists and is large enough to be complete"""
    for root, _, files in os.walk(cache_dir):
        if 'model.safetensors' in files:
            fp = os.path.join(root, 'model.safetensors')
            try:
                if os.path.getsize(fp) > 10 * 1024 * 1024:
                    return True
            except OSError:
                pass
    return False


def _ensure_model_downloaded(cache_dir):
    """Download model if not cached, reporting progress via stdout JSON"""
    os.makedirs(cache_dir, exist_ok=True)

    if _is_model_cached(cache_dir):
        return

    sys.stderr.write("Model not cached — downloading for first launch...\n")
    sys.stderr.flush()

    EXPECTED_BYTES = 48 * 1024 * 1024  # ~48 MB expected total
    initial_size = _get_dir_size(cache_dir)
    done = threading.Event()
    error_holder = [None]

    print(json.dumps({"status": "downloading", "progress": 0}), flush=True)

    def _download():
        try:
            from huggingface_hub import snapshot_download
            snapshot_download('ZhengPeng7/BiRefNet_lite', cache_dir=cache_dir)
        except Exception as e:
            error_holder[0] = e
        finally:
            done.set()

    thread = threading.Thread(target=_download, daemon=True)
    thread.start()

    last_pct = -1
    while not done.is_set():
        current_size = _get_dir_size(cache_dir)
        downloaded = current_size - initial_size
        pct = max(0, min(95, int(downloaded / EXPECTED_BYTES * 100)))
        if pct != last_pct:
            print(json.dumps({"status": "downloading", "progress": pct}), flush=True)
            last_pct = pct
        done.wait(timeout=0.5)

    thread.join()

    if error_holder[0]:
        print(json.dumps({"status": "download_error", "error": str(error_holder[0])}), flush=True)
        raise error_holder[0]

    print(json.dumps({"status": "downloading", "progress": 100}), flush=True)
    sys.stderr.write("Model download complete.\n")
    sys.stderr.flush()


class BiRefNetServer:
    def __init__(self):
        self.model = None
        self.load_model()
    
    def load_model(self):
        """Load model once at startup"""
        try:
            cache_dir = _get_cache_dir()
            _ensure_model_downloaded(cache_dir)
            
            sys.stderr.write("Loading AI model...\n")
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
