#!/usr/bin/env python3
"""
Export BiRefNet-Lite model to TorchScript for fast loading
TorchScript loads ~3-4x faster than PyTorch (no model reconstruction needed)
"""
import sys
import os

# Suppress noisy output
os.environ['TQDM_DISABLE'] = '1'
os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'

import torch
import numpy as np

# Add parent dir
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def export_to_torchscript():
    """Export BiRefNet-Lite to TorchScript format"""
    
    print("Loading PyTorch model...")
    from birefnet_model import BiRefNetLite
    
    # Load the PyTorch model
    model_wrapper = BiRefNetLite()
    backend = model_wrapper._backend
    model = backend._model
    device = backend._device
    
    model.eval()
    print(f"Model loaded on {device}")
    
    # Export path
    script_path = os.path.join(os.path.dirname(__file__), 'birefnet_lite.pt')
    
    print(f"Exporting to TorchScript: {script_path}")
    
    # Create dummy input (same size as speed mode)
    dummy_input = torch.randn(1, 3, 320, 320, device=device)
    
    if device.type == 'cuda':
        dummy_input = dummy_input.half()
        model = model.half()
    
    # Trace the model with strict=False to handle control flow
    with torch.no_grad():
        print("Tracing model (this may take 1-2 minutes)...")
        
        # Use trace with strict=False for more flexibility
        traced_model = torch.jit.trace(model, dummy_input, strict=False, check_trace=False)
        
        # Save
        traced_model.save(script_path)
        print(f"✅ Traced model saved")
    
    # Get file size
    size_mb = os.path.getsize(script_path) / (1024 * 1024)
    print(f"✅ TorchScript export complete: {size_mb:.1f}MB")
    print(f"   Path: {script_path}")
    
    return True

if __name__ == '__main__':
    success = export_to_torchscript()
    sys.exit(0 if success else 1)
