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
- npm or yarn

## Tech Stack

- Electron.js
- @imgly/background-removal-node (AI background removal)
- Vanilla JavaScript

## Note

The first time you process an image, the AI model will be downloaded (~30MB). After that, everything works offline.

## License

MIT License - Made by SalluLabs
