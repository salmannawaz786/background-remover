# Installation Guide for BiRefNet-Lite Integration

## Quick Install (Recommended)

The installation failed due to network timeout while downloading PyTorch. Follow these steps:

### Step 1: Install Basic Dependencies
```powershell
pip install -r requirements.txt
```

### Step 2: Install PyTorch Separately (Better for Slow Connections)

#### Option A: CPU Version (Smaller, Faster Download)
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

#### Option B: GPU Version (If you have NVIDIA GPU)
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

#### Option C: Alternative Mirror (If PyTorch servers are slow)
```powershell
pip install torch torchvision -f https://download.pytorch.org/whl/torch_stable.html
```

### Step 3: Verify Installation
```powershell
python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}')"
```

## Alternative Installation Methods

### Method 1: Use Conda (More Reliable for Large Packages)
```powershell
# Install PyTorch via conda
conda install pytorch torchvision -c pytorch

# Install remaining packages
pip install flask flask-cors pillow werkzeug psutil waitress python-dotenv firebase-admin gunicorn transformers numpy timm
```

### Method 2: Download Wheels Offline
If internet is very slow:

1. Download these files manually:
   - `torch-2.0.0-cp313-cp313-win_amd64.whl`
   - `torchvision-0.15.0-cp313-cp313-win_amd64.whl`

2. Install locally:
```powershell
pip install torch-2.0.0-cp313-cp313-win_amd64.whl
pip install torchvision-0.15.0-cp313-cp313-win_amd64.whl
pip install -r requirements.txt
```

### Method 3: Use Mirror Sites
```powershell
# Use Tsinghua mirror (faster in Asia)
pip install torch torchvision -i https://pypi.tuna.tsinghua.edu.cn/simple/

# Or use Alibaba mirror
pip install torch torchvision -i https://mirrors.aliyun.com/pypi/simple/
```

## Troubleshooting

### Issue: Timeout during PyTorch download
**Solution**: Use CPU version first, it's smaller:
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### Issue: "Read timed out" errors
**Solution**: Increase pip timeout:
```powershell
pip install --timeout 1000 torch torchvision
```

### Issue: SSL Certificate errors
**Solution**: Use trusted hosts:
```powershell
pip install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org torch torchvision
```

### Issue: Python 3.13 compatibility
**Solution**: Use Python 3.10 or 3.11 for better compatibility:
```powershell
# Create new environment with Python 3.11
python -m venv .venv311
.venv311\Scripts\activate
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

## Minimal Working Setup

If you want to test quickly without full GPU support:

1. Install minimal requirements:
```powershell
pip install flask flask-cors pillow werkzeug
```

2. Install light PyTorch:
```powershell
pip install torch==1.13.0 torchvision==0.14.0 --index-url https://download.pytorch.org/whl/cpu
```

3. Install remaining:
```powershell
pip install transformers numpy timm psutil waitress python-dotenv
```

## Verification

Once installed, test with:
```powershell
python server.py
```

Expected output:
```
INFO: Successfully loaded BiRefNet-Lite model
INFO: Device info: {'device': 'cpu', 'model_loaded': True}
INFO: Starting Background Remover service with BiRefNet-Lite...
```

## Performance Note

- **CPU Version**: Will work but slower (2-3s per image)
- **GPU Version**: Much faster (0.3-0.5s per image)
- **Model Download**: BiRefNet model (~100MB) downloads on first run

## Need Help?

If installation still fails:
1. Try the CPU version first
2. Use conda instead of pip
3. Download wheels manually
4. Use different mirror sites

The app will work with CPU version - you can upgrade to GPU later!
