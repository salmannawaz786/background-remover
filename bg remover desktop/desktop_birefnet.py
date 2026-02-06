#!/usr/bin/env python3
"""
Desktop BiRefNet wrapper for Electron
Reads input file path from stdin, outputs base64 result to stdout
Usage: python desktop_birefnet.py <input_path> <hd_mode>
"""
import sys
import os
import json
import base64
import io
import time
from PIL import Image

# Add parent dir to path to import birefnet_model
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def process_image(input_path, hd_mode=False):
    """Process single image and return base64 result"""
    try:
        # Lazy import to speed up startup when just checking
        from birefnet_model import BiRefNetLite
        
        # Load image
        input_image = Image.open(input_path).convert('RGB')
        
        # Get model instance (singleton, loads once)
        model = BiRefNetLite()
        
        # Process
        start_time = time.time()
        output_image = model.remove_background(
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
        
        result = {
            'success': True,
            'data': base64.b64encode(img_io.read()).decode('utf-8'),
            'format': 'webp',
            'time': round(elapsed, 2)
        }
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No input file provided'}))
        sys.exit(1)
    
    input_path = sys.argv[1]
    hd_mode = sys.argv[2].lower() == 'true' if len(sys.argv) > 2 else False
    
    # Check file exists
    if not os.path.exists(input_path):
        print(json.dumps({'success': False, 'error': f'File not found: {input_path}'}))
        sys.exit(1)
    
    result = process_image(input_path, hd_mode)
    print(json.dumps(result))
