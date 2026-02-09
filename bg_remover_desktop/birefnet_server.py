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
    """Get the model cache directory based on environment"""
    if getattr(sys, 'frozen', False):
        bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(sys.executable)))
        bundled_cache = os.path.join(bundle_dir, 'model_cache')
        if os.path.exists(bundled_cache):
            return bundled_cache
        return os.path.join(os.path.expanduser('~'), '.sallulabs', 'model_cache')
    else:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.model_cache')


def _is_model_cached(cache_dir):
    """Check if model is already downloaded in cache"""
    try:
        from transformers import AutoModelForImageSegmentation
        AutoModelForImageSegmentation.from_pretrained(
            'ZhengPeng7/BiRefNet_lite',
            trust_remote_code=True,
            cache_dir=cache_dir,
            local_files_only=True
        )
        return True
    except Exception:
        return False


def _get_dir_size(path):
    """Get total size of a directory in bytes"""
    total = 0
    try:
        for dp, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dp, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except OSError:
        pass
    return total


def _download_model_with_progress(cache_dir):
    """Download model while reporting progress via stdout JSON"""
    # Expected size: BiRefNet_lite is ~44MB of model files + metadata
    EXPECTED_SIZE_BYTES = 46 * 1024 * 1024

    print(json.dumps({
        "status": "downloading",
        "progress": 0,
        "message": "Downloading AI model (first time only)..."
    }), flush=True)

    result = {"model": None, "error": None, "done": False}

    def do_download():
        try:
            from transformers import AutoModelForImageSegmentation
            model = AutoModelForImageSegmentation.from_pretrained(
                'ZhengPeng7/BiRefNet_lite',
                trust_remote_code=True,
                cache_dir=cache_dir
            )
            result["model"] = model
        except Exception as e:
            result["error"] = str(e)
        finally:
            result["done"] = True

    t = threading.Thread(target=do_download, daemon=True)
    t.start()

    last_progress = -1
    while not result["done"]:
        time.sleep(0.8)
        current_size = _get_dir_size(cache_dir)
        progress = min(95, int(current_size / EXPECTED_SIZE_BYTES * 100))
        if progress != last_progress:
            print(json.dumps({
                "status": "downloading",
                "progress": progress,
                "message": f"Downloading AI model... {progress}%"
            }), flush=True)
            last_progress = progress

    if result["error"]:
        raise Exception(result["error"])

    print(json.dumps({
        "status": "downloading",
        "progress": 100,
        "message": "Download complete! Loading model..."
    }), flush=True)

    return result["model"]


class BiRefNetServer:
    def __init__(self):
        self.model = None
        self.load_model()
    
    def load_model(self):
        """Load model once at startup, with download progress on first run"""
        try:
            cache_dir = _get_cache_dir()
            os.makedirs(cache_dir, exist_ok=True)

            load_start = time.time()

            if _is_model_cached(cache_dir):
                sys.stderr.write("Loading AI model from cache...\n")
                sys.stderr.flush()
                print(json.dumps({"status": "loading", "message": "Loading AI model..."}), flush=True)
                from birefnet_model import BiRefNetLite
                self.model = BiRefNetLite()
            else:
                sys.stderr.write("Model not cached, downloading...\n")
                sys.stderr.flush()
                # Download with progress, then load via BiRefNetLite (which uses cached model)
                _download_model_with_progress(cache_dir)
                print(json.dumps({"status": "loading", "message": "Initializing AI engine..."}), flush=True)
                from birefnet_model import BiRefNetLite
                self.model = BiRefNetLite()
            
            load_time = time.time() - load_start
            sys.stderr.write(f"BiRefNet server ready ({load_time:.1f}s)\n")
            sys.stderr.flush()
            print(json.dumps({"status": "ready", "message": "Model loaded"}), flush=True)
        except Exception as e:
            sys.stderr.write(f"Model load failed: {e}\n")
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
