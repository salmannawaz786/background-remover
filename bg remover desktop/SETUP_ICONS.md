# Icon Setup Instructions

I've saved your SalluLabs logo. Now you need to create the icon files for Windows, macOS, and Linux.

## Quick Setup

### Option 1: Online Converter (Easiest)

1. **For Windows (.ico):**
   - Go to https://convertio.co/png-ico/
   - Upload: `d:\background-remover-master\static\images\logo.png`
   - Download the .ico file
   - Save as: `d:\background-remover-master\bg remover desktop\assets\icon.ico`

2. **For macOS (.icns):**
   - Go to https://cloudconvert.com/png-to-icns
   - Upload: `d:\background-remover-master\static\images\logo.png`
   - Download the .icns file
   - Save as: `d:\background-remover-master\bg remover desktop\assets\icon.icns`

3. **For Linux (.png):**
   - Copy your logo: `d:\background-remover-master\static\images\logo.png`
   - Resize to 512x512 if needed
   - Save as: `d:\background-remover-master\bg remover desktop\assets\icon.png`

### Option 2: Using ImageMagick (If installed)

```bash
cd "d:\background-remover-master\bg remover desktop\assets"

# Windows
magick "d:\background-remover-master\static\images\logo.png" -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Linux
magick "d:\background-remover-master\static\images\logo.png" -resize 512x512 icon.png
```

For macOS .icns, you still need to use the online converter or macOS tools.

## After Creating Icons

1. Make sure you have these files:
   - `assets/icon.ico` (Windows)
   - `assets/icon.icns` (macOS)
   - `assets/icon.png` (Linux, 512x512)

2. Build the app:
   ```bash
   cd "d:\background-remover-master\bg remover desktop"
   npm run build:win   # For Windows
   npm run build:mac   # For macOS (requires macOS)
   npm run build:linux # For Linux
   ```

The built apps will appear in the `dist` folder with your SalluLabs branding!

## Your Logo

Your beautiful yellow "S" logo will appear as:
- App icon in taskbar/dock
- Window icon
- Installer icon
- Desktop shortcut icon

Perfect for SalluLabs brand consistency! 🎨
