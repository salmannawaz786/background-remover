# Ubuntu 24.04 OpenCV Fix

## The Problem
Ubuntu 24.04 (Noble) has different package names for OpenGL libraries.

## Correct Commands for Ubuntu 24.04

```bash
# Install OpenGL and system dependencies for OpenCV
sudo apt install -y libgl1-mesa-dev libglib2.0-0t64 libsm6 libxext6 libxrender-dev libgomp1

# Alternative if above doesn't work:
sudo apt install -y libgl1-mesa-glx libglu1-mesa-dev libglib2.0-0t64

# Install additional dependencies
sudo apt install -y libgtk-3-dev libavcodec-dev libavformat-dev libswscale-dev
```

## Test OpenCV

```bash
# Test OpenCV import (use single quotes to avoid bash history expansion)
python -c 'import cv2; print("OpenCV version:", cv2.__version__)'
```

## Download Models After Fix

```bash
python -c "
from model_manager_v4 import RVM_CONFIG, RMBG_CONFIG, _download_model
_download_model(RVM_CONFIG['url'], RVM_CONFIG['file'], 'RVM')
_download_model(RMBG_CONFIG['url'], RMBG_CONFIG['file'], 'RMBG')
print('Models downloaded successfully')
"
```

## If Still Issues - Use Headless OpenCV

```bash
# Uninstall current OpenCV
pip uninstall opencv-python opencv-contrib-python

# Install headless version (no GUI dependencies)
pip install opencv-python-headless==4.8.1.78

# Test
python -c 'import cv2; print("OpenCV headless works!")'
```

## Why This Happens

Ubuntu 24.04 renamed some packages:
- `libgl1-mesa-glx` → `libgl1-mesa-dev` or not available
- `libglib2.0-0` → `libglib2.0-0t64`

The headless version is often better for servers since it doesn't require GUI libraries.

---

**Try the headless version first - it's more reliable for servers!**
