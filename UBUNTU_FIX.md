# Ubuntu OpenCV Fix

## The Problem
```
ImportError: libGL.so.1: cannot open shared object file: No such file or directory
```

## Quick Fix Commands
Run these on your Ubuntu server:

```bash
# Update package list
sudo apt update

# Install OpenGL and system dependencies for OpenCV
sudo apt install -y libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1

# Alternative (if above doesn't work):
sudo apt install -y libgl1-mesa-dev libglib2.0-0 libgtk-3-dev libavcodec-dev libavformat-dev libswscale-dev

# Install additional dependencies if needed
sudo apt install -y python3-opencv
```

## After Installing Dependencies

```bash
# Test OpenCV import
python -c "import cv2; print('OpenCV version:', cv2.__version__)"

# Download models
python -c "
from model_manager_v4 import RVM_CONFIG, RMBG_CONFIG, _download_model
_download_model(RVM_CONFIG['url'], RVM_CONFIG['file'], 'RVM')
_download_model(RMBG_CONFIG['url'], RMBG_CONFIG['file'], 'RMBG')
print('Models downloaded successfully')
"
```

## If Still Fails

### Option 1: Install OpenCV with pip
```bash
pip uninstall opencv-python
pip install opencv-python-headless
```

### Option 2: Use headless version
```bash
pip install opencv-python-headless==4.8.1.78
```

### Option 3: Rebuild OpenCV
```bash
pip uninstall opencv-python opencv-contrib-python
pip install opencv-python==4.8.1.78 opencv-contrib-python==4.8.1.78
```

## For Production Deployment

Add these to your deployment script:

```bash
# In DEPLOYMENT_GUIDE.md, add this after "Install system dependencies for OpenCV"
apt install -y libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1
```

## Why This Happens

OpenCV needs OpenGL libraries for image processing. Ubuntu server doesn't have them by default. The `libgl1-mesa-glx` package provides the OpenGL implementation.

---

**Run the fix commands above, then try downloading models again!**
