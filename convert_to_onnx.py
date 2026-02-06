# convert_to_onnx.py
# Converts BiRefNet-Lite to ONNX for 3-5x faster CPU inference

import torch
from pathlib import Path
import argparse

def export(input_size=512, optimize=True):
    """
    Export BiRefNet-Lite to ONNX format
    
    Args:
        input_size: Input resolution (512 for speed, 1024 for quality)
        optimize: Apply ONNX optimizations
    """
    from transformers import AutoModelForImageSegmentation
    
    # Correct model ID for BiRefNet-Lite
    model_id = "ZhengPeng7/BiRefNet_lite"
    
    print(f"="*60)
    print(f"BiRefNet-Lite ONNX Converter")
    print(f"="*60)
    print(f"Model: {model_id}")
    print(f"Input Size: {input_size}x{input_size}")
    print(f"Optimize: {optimize}")
    print(f"="*60)
    
    print(f"\n[1/4] Downloading model from HuggingFace...")
    try:
        model = AutoModelForImageSegmentation.from_pretrained(
            model_id, 
            trust_remote_code=True
        )
        model.eval()
        print(f"      Model loaded successfully!")
    except Exception as e:
        print(f"ERROR: Failed to load model: {e}")
        return None
    
    # Create dummy input
    print(f"\n[2/4] Preparing model for export...")
    dummy_input = torch.randn(1, 3, input_size, input_size)
    
    output_path = f"birefnet_lite_{input_size}.onnx"
    
    print(f"\n[3/4] Exporting to ONNX (this may take 1-2 minutes)...")
    
    try:
        with torch.no_grad():
            torch.onnx.export(
                model,
                dummy_input,
                output_path,
                input_names=['input'],
                output_names=['output'],
                opset_version=17,  # Latest stable opset
                do_constant_folding=True,  # Optimize constants
                export_params=True,
                verbose=False
            )
        print(f"      Export completed!")
    except Exception as e:
        print(f"ERROR: ONNX export failed: {e}")
        return None
    
    # Optimize the ONNX model
    if optimize:
        print(f"\n[4/4] Optimizing ONNX model...")
        try:
            import onnx
            from onnxruntime.transformers import optimizer
            
            # Load and optimize
            optimized_path = f"birefnet_lite_{input_size}_optimized.onnx"
            
            # Basic optimization with onnxruntime
            import onnxruntime as ort
            sess_options = ort.SessionOptions()
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sess_options.optimized_model_filepath = optimized_path
            
            # This will save the optimized model
            _ = ort.InferenceSession(output_path, sess_options)
            
            if Path(optimized_path).exists():
                output_path = optimized_path
                print(f"      Optimization completed!")
            else:
                print(f"      Using non-optimized model")
                
        except ImportError:
            print(f"      Skipping optimization (onnx/onnxruntime not installed)")
        except Exception as e:
            print(f"      Optimization skipped: {e}")
    
    # Report results
    file_size_mb = Path(output_path).stat().st_size / (1024*1024)
    
    print(f"\n" + "="*60)
    print(f"SUCCESS!")
    print(f"="*60)
    print(f"Output: {output_path}")
    print(f"Size: {file_size_mb:.2f} MB")
    print(f"\nTo use this model, copy it to your project folder.")
    print(f"The server will automatically detect and use the ONNX model.")
    print(f"="*60)
    
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Convert BiRefNet-Lite to ONNX')
    parser.add_argument('--size', type=int, default=512, choices=[512, 1024],
                        help='Input size (512 for speed, 1024 for quality)')
    parser.add_argument('--no-optimize', action='store_true',
                        help='Skip ONNX optimization')
    
    args = parser.parse_args()
    export(input_size=args.size, optimize=not args.no_optimize)