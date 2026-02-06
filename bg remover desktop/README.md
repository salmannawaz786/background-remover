# BG Remover Desktop

Offline background remover desktop application built with Electron.js. Remove backgrounds from images without internet connection - your images stay 100% private on your device.

## Features

- 🖥️ **100% Offline** - No internet required
- 🔒 **Privacy First** - Images never leave your device
- ⚡ **Fast Processing** - Uses local AI model
- 📁 **Batch Processing** - Process multiple images at once
- 🌙 **Dark Mode** - Easy on the eyes

## Installation

### Development

1. Install dependencies:
```bash
npm install
```

2. Start the app:
```bash
npm start
```

### Build for Distribution

**Windows:**
```bash
npm run build:win
```

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

Built files will be in the `dist` folder.

## Requirements

- Node.js 18+
- Python 3.8+ with dependencies:
  ```bash
  pip install onnxruntime pillow numpy opencv-python-headless
  ```

## Tech Stack

- Electron.js
- ONNX Runtime (AI background removal - 5x faster than PyTorch)
- BiRefNet-Lite model
- Vanilla JavaScript

## Note

The AI model loads in 2-3 seconds on startup (ONNX Runtime). First-time setup may download the model (~200MB) which is cached for future use.

## License

MIT License - Made by SalluLabs
