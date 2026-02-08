# SalluLabs Watermark Remover - Desktop Edition

AI-powered watermark and object remover by SalluLabs. This desktop application uses Samsung's LaMa AI model to remove unwanted objects and watermarks from images with precision.

## Features

- 🖼️ **Local Processing** - All image processing happens on your device
- 🚀 **GPU Acceleration** - Automatic detection and use of NVIDIA CUDA or Apple Silicon MPS
- 🎨 **Intuitive Editor** - Easy-to-use brush tool for marking areas to remove
- 💻 **Cross-Platform** - Works on Windows, macOS, and Linux
- 🔒 **Privacy First** - Your images never leave your computer

## Installation

### Prerequisites

1. **Node.js** (v18 or later) - [Download](https://nodejs.org/)
2. **Python 3.8+** - [Download](https://python.org/)
3. **Python Dependencies**:
   ```bash
   cd python
   pip install -r requirements.txt
   ```

4. **(Optional) PyTorch for LaMa Model**:
   - **CPU only**: `pip install torch torchvision`
   - **NVIDIA GPU**: `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118`
   - **Apple Silicon**: `pip install torch torchvision`

### Setup

1. Clone or download this repository
2. Install Node.js dependencies:
   ```bash
   cd desktop
   npm install
   ```

3. (Optional) Download the LaMa model:
   - Download `big-lama.pt` from [LaMa releases](https://github.com/advimman/lama)
   - Place it in the `models/` folder

### Running the App

```bash
npm start
```

For development mode with DevTools:
```bash
npm run dev
```

## Building Distributable

### Windows
```bash
npm run build:win
```

### macOS
```bash
npm run build:mac
```

### Linux
```bash
npm run build:linux
```

Built applications will be in the `dist/` folder.

## Usage

1. **Upload an Image** - Click "Select a picture" or drag and drop an image
2. **Mark Areas** - Use the brush tool to paint over watermarks or objects to remove
3. **Adjust Brush Size** - Use the slider to change brush size
4. **Process** - Click "Remove Selected Areas" to start AI processing
5. **Download** - Save your clean image

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + O | Open image |
| Ctrl/Cmd + S | Save result |
| Ctrl/Cmd + Z | Undo last brush stroke |
| Ctrl/Cmd + Shift + C | Clear mask |
| Ctrl/Cmd + R | Reset image |

## Technical Details

### GPU Detection

The app automatically detects available hardware:
- **NVIDIA GPU** - Uses CUDA for fastest processing
- **Apple Silicon** - Uses Metal Performance Shaders (MPS)
- **CPU** - Falls back to CPU processing (slower but always works)

### Processing Pipeline

1. Image and mask are saved to temp files
2. Python backend processes using LaMa model (or OpenCV fallback)
3. Result is returned and displayed
4. Temp files are cleaned up

## Troubleshooting

### "Python not found"
Make sure Python 3 is installed and added to your PATH.

### "Processing failed"
- Ensure all Python dependencies are installed
- Check if the mask actually covers the area to remove
- Try with a smaller image first

### Slow processing
- Enable GPU acceleration by installing PyTorch with CUDA/MPS support
- Large images take longer - try resizing before processing

## Support

- Website: [sallulabs.com](https://sallulabs.com)
- Email: salman.nawaz@SalluLabs.com
- WhatsApp: +92 310 279 1036

## License

MIT License - © 2025 SalluLabs

---

Made with ♥ in Pakistan
