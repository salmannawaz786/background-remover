#!/usr/bin/env python3
"""
Export BiRefNet-Lite model to ONNX format for fast loading in desktop app
ONNX Runtime loads ~3-5x faster than PyTorch
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

def export_to_onnx():
    """Export BiRefNet-Lite to ONNX format"""
    
    print("Loading PyTorch model...")
    from birefnet_model import BiRefNetLite
    
    # Load the PyTorch model
    model_wrapper = BiRefNetLite()
    # Get raw PyTorch model from the wrapper
    backend = model_wrapper._backend
    model = backend._model
    device = backend._device
    
    model.eval()
    print(f"Model loaded on {device}")
    
    # Create dummy input (same size as speed mode)
    dummy_input = torch.randn(1, 3, 320, 320, device=device)
    
    if device.type == 'cuda':
        dummy_input = dummy_input.half()
        model = model.half()
    
    # Export path
    onnx_path = os.path.join(os.path.dirname(__file__), 'birefnet_lite.onnx')
    
    print(f"Exporting to ONNX: {onnx_path}")
    
    # Export to ONNX
    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy_input,
            onnx_path,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={
                'input': {0: 'batch_size', 2: 'height', 3: 'width'},
                'output': {0: 'batch_size', 2: 'height', 3: 'width'}
            },
            opset_version=11,
            do_constant_folding=True,
            export_params=True,
            verbose=False
        )
    
    # Get file size
    size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"✅ ONNX export complete: {size_mb:.1f}MB")
    print(f"   Path: {onnx_path}")
    
    # Test load with ONNX Runtime
    print("\nTesting ONNX Runtime load...")
    try:
        import onnxruntime as ort
        
        # Create session options for speed
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = min(os.cpu_count() or 4, 8)
        
        # Load model
        load_start = torch.cuda.Event(enable_timing=True) if torch.cuda.is_available() else None
        import time
        t0 = time.time()
        
        session = ort.InferenceSession(onnx_path, sess_options)
        
        load_time = time.time() - t0
        print(f"✅ ONNX Runtime loaded in {load_time:.2f}s")
        
        # Test inference
        test_input = np.random.randn(1, 3, 320, 320).astype(np.float32)
        if device.type == 'cuda':
            test_input = test_input.astype(np.float16)
        
        t0 = time.time()
        output = session.run(None, {'input': test_input})
        infer_time = time.time() - t0
        print(f"✅ Test inference: {infer_time:.2f}s")
        
        return True
        
    except ImportError:
        print("⚠️ onnxruntime not installed. Install with: pip install onnxruntime")
        return False
    except Exception as e:
        print(f"❌ ONNX test failed: {e}")
        return False

if __name__ == '__main__':
    success = export_to_onnx()
    sys.exit(0 if success else 1)
