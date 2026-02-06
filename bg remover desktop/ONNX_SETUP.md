# ONNX Desktop Setup Instructions

## Overview
ONNX Runtime provides ~3-5x faster model loading than PyTorch.

## Setup Steps

### 1. Install Python Dependencies
```bash
pip install onnxruntime opencv-python
```

### 2. Export PyTorch Model to ONNX (One-time)
```bash
cd "bg remover desktop"
python export_onnx.py
```

This creates `birefnet_lite.onnx` (~170MB) in the desktop folder.

### 3. Build Desktop App
```bash
cd "bg remover desktop"
npm run build:win
```

## How It Works

- **PyTorch version**: ~24s cold start (loads transformers, torch, materializes 586 weight tensors)
- **ONNX version**: ~4-6s cold start (loads single .onnx file into ONNX Runtime)

Both versions:
- Keep model in memory for fast repeated processing
- Support HD/Speed modes
- Upload to R2 when authenticated

## File Structure
```
bg remover desktop/
├── birefnet_server_onnx.py    # ONNX server (fast loading)
├── birefnet_lite.onnx         # Exported model (created by export_onnx.py)
├── export_onnx.py             # Export script
└── main.js                    # Uses birefnet_server_onnx.py
```

## Troubleshooting

**"ONNX model not found" error**: Run `python export_onnx.py` first to create the .onnx file.

**"onnxruntime not installed"**: Run `pip install onnxruntime` in your Python environment.

**Export fails with CUDA error**: The export works on CPU too - temporarily disable CUDA or export on a CPU machine.
