const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const { setupAuthHandlers, getCurrentUser, setCurrentUser } = require('./auth');

// Load .env file - check multiple locations for dev and packaged app
const dotenv = require('dotenv');
const envPaths = [
    path.join(__dirname, '.env'),           // Desktop app folder (dev)
    path.join(__dirname, '..', '.env'),     // Root repo folder (dev)
    path.join(process.resourcesPath || __dirname, '.env')  // Packaged app resources
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        console.log('Loaded .env from:', envPath);
        break;
    }
}

// Initialize persistent store
const store = new Store({
    encryptionKey: 'sallulabs-bg-remover-secure-key-2024'
});

let mainWindow;

if (process.platform === 'win32') {
    app.setAppUserModelId('com.sallulabs.bgremover');
}

// Enable GPU acceleration and improve stability
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

// Memory management for stability
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// ============================================
// Device Detection: GPU + Apple Silicon
// ============================================
let deviceInfo = {
    platform: process.platform,
    arch: process.arch,
    hasNvidiaGpu: false,
    gpuName: 'CPU',
    isAppleSilicon: false,
    cpuCores: require('os').cpus().length,
    optimalDevice: 'cpu'
};

function detectDevice() {
    // Detect Apple Silicon (M1, M2, M3, M4)
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        deviceInfo.isAppleSilicon = true;
        deviceInfo.gpuName = 'Apple Silicon (Metal)';
        deviceInfo.optimalDevice = 'gpu';
        console.log('Detected Apple Silicon - using Metal acceleration');
    }
    
    // Detect NVIDIA GPU on Windows/Linux
    if (process.platform === 'win32' || process.platform === 'linux') {
        try {
            const nvidiaSmi = execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits', {
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe']
            }).toString().trim();
            
            if (nvidiaSmi) {
                deviceInfo.hasNvidiaGpu = true;
                deviceInfo.gpuName = nvidiaSmi.split('\n')[0].trim();
                deviceInfo.optimalDevice = 'gpu';
                console.log(`Detected NVIDIA GPU: ${deviceInfo.gpuName}`);
            }
        } catch (e) {
            console.log('No NVIDIA GPU detected - using CPU');
        }
    }
    
    console.log('Device info:', JSON.stringify(deviceInfo, null, 2));
    return deviceInfo;
}

detectDevice();

// Prevent app from crashing on unhandled exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

function createWindow() {
    // Hide menu bar on Windows/Linux
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
    }
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        autoHideMenuBar: true,
        frame: true,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#1a1a1a'
    });

    // Check if user needs authentication first
    mainWindow.loadFile('auth.html');
    
    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(() => {
    // Setup authentication handlers
    setupAuthHandlers(store);
    
    // Restore saved auth state
    const savedUser = store.get('user');
    const savedToken = store.get('token');
    if (savedUser && savedToken) {
        setCurrentUser(savedUser, savedToken);
    }
    
    createWindow();
    
    // Check for updates (only in production)
    if (!process.argv.includes('--dev') && app.isPackaged) {
        checkForUpdates();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Auto-updater configuration
autoUpdater.autoDownload = true;  // Automatically download updates
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

// Set GitHub as update source
autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Johny111ishxb',
    repo: 'background-remover'
});

function checkForUpdates() {
    console.log('🔍 Checking for updates...');
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('Update check failed:', err);
    });
}

autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
    console.log('✅ Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info);
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('✓ App is up to date:', info.version);
});

autoUpdater.on('download-progress', (progress) => {
    console.log(`⬇️ Download progress: ${Math.round(progress.percent)}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', progress);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info);
    }
});

autoUpdater.on('error', (err) => {
    console.error('❌ Auto-updater error:', err);
});

// IPC handler to trigger update download
ipcMain.handle('download-update', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler to install update and restart
ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
});

// Cloudflare R2 Configuration (stored securely - replace with your values)
const R2_CONFIG = {
    endpoint: process.env.R2_ENDPOINT || '',
    accessKeyId: process.env.R2_ACCESS_KEY || '',
    secretAccessKey: process.env.R2_SECRET_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || '',
    publicDomain: process.env.R2_PUBLIC_DOMAIN || ''
};

// R2 upload handler
ipcMain.handle('upload-to-r2', async (event, { imageData, filename }) => {
    try {
        // Check if R2 is configured
        if (!R2_CONFIG.endpoint || !R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey || !R2_CONFIG.bucketName) {
            console.log('⚠️ R2 not configured - skipping upload');
            return { success: false, error: 'R2 not configured' };
        }
        
        // Use require for AWS SDK (CommonJS compatible with Electron)
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
        
        // Initialize S3 client for R2
        const s3Client = new S3Client({
            region: 'auto',
            endpoint: R2_CONFIG.endpoint,
            credentials: {
                accessKeyId: R2_CONFIG.accessKeyId,
                secretAccessKey: R2_CONFIG.secretAccessKey
            }
        });
        
        // Convert data URL to buffer
        let buffer;
        let contentType = 'image/webp';
        if (typeof imageData === 'string' && imageData.startsWith('data:')) {
            // Extract content type from data URL
            const mimeMatch = imageData.match(/^data:(image\/\w+);base64,/);
            if (mimeMatch) contentType = mimeMatch[1];
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(base64Data, 'base64');
        } else if (imageData instanceof ArrayBuffer || Buffer.isBuffer(imageData)) {
            buffer = Buffer.from(imageData);
        } else {
            console.error('❌ R2: Unsupported imageData type:', typeof imageData);
            return { success: false, error: 'Unsupported image data format' };
        }
        
        console.log(`📤 R2 uploading: ${filename} (${(buffer.length / 1024).toFixed(1)}KB, ${contentType})`);
        
        // Upload to R2
        const command = new PutObjectCommand({
            Bucket: R2_CONFIG.bucketName,
            Key: filename,
            Body: buffer,
            ContentType: contentType
        });
        
        await s3Client.send(command);
        
        // Generate public URL
        let publicUrl;
        if (R2_CONFIG.publicDomain) {
            publicUrl = `${R2_CONFIG.publicDomain}/${filename}`;
        } else {
            publicUrl = `https://${R2_CONFIG.bucketName}.r2.dev/${filename}`;
        }
        
        console.log('✅ R2 upload success:', publicUrl);
        return { success: true, url: publicUrl };
        
    } catch (error) {
        console.error('❌ R2 upload error:', error.message);
        return { success: false, error: error.message };
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Get MIME type for image extension
function getMimeType(ext) {
    const mimeTypes = {
        'jpg': 'jpeg',
        'jpeg': 'jpeg',
        'png': 'png',
        'gif': 'gif',
        'webp': 'webp',
        'bmp': 'bmp',
        'tiff': 'tiff',
        'tif': 'tiff'
    };
    return mimeTypes[ext.toLowerCase()] || 'png';
}

// Handle file selection
ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeType = getMimeType(ext);
        return {
            path: filePath,
            data: `data:image/${mimeType};base64,${base64}`,
            name: path.basename(filePath)
        };
    }
    return null;
});

// Handle multiple file selection
ipcMain.handle('select-images', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths.map(filePath => {
            const buffer = fs.readFileSync(filePath);
            const base64 = buffer.toString('base64');
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const mimeType = getMimeType(ext);
            return {
                path: filePath,
                data: `data:image/${mimeType};base64,${base64}`,
                name: path.basename(filePath)
            };
        });
    }
    return [];
});

// Handle save file
ipcMain.handle('save-image', async (event, { data, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName || 'background-removed.png',
        filters: [
            { name: 'PNG Image', extensions: ['png'] }
        ]
    });
    
    if (!result.canceled && result.filePath) {
        // Remove data URL prefix
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(result.filePath, buffer);
        return { success: true, path: result.filePath };
    }
    return { success: false };
});

// Track if processing is in progress to prevent multiple concurrent operations
let isProcessing = false;

// Persistent Python BiRefNet server
let birefnetServer = null;
let serverReady = false;

// Start the persistent Python server
function startBiRefNetServer() {
    if (birefnetServer) return;
    
    const { spawn } = require('child_process');
    const scriptPath = path.join(__dirname, 'birefnet_server.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    console.log('Starting BiRefNet Python server...');
    
    birefnetServer = spawn(pythonCmd, [scriptPath], {
        cwd: __dirname,
        env: {
            ...process.env,
            PYTHONPATH: path.dirname(__dirname)
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let buffer = '';
    
    birefnetServer.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.status === 'ready') {
                        serverReady = true;
                        console.log('✅ BiRefNet server ready');
                    }
                } catch (e) {
                    // Not JSON, just log it
                    console.log('[Python]', line);
                }
            }
        }
    });
    
    birefnetServer.stderr.on('data', (data) => {
        console.log('[Python stderr]', data.toString().trim());
    });
    
    birefnetServer.on('close', (code) => {
        console.log(`BiRefNet server exited with code ${code}`);
        birefnetServer = null;
        serverReady = false;
    });
    
    birefnetServer.on('error', (err) => {
        console.error('Failed to start BiRefNet server:', err);
    });
}

// Process image using persistent server
async function processWithServer(filePath, hdMode) {
    return new Promise((resolve, reject) => {
        if (!birefnetServer || !serverReady) {
            reject(new Error('Server not ready'));
            return;
        }
        
        const cmd = JSON.stringify({
            action: 'process',
            path: filePath,
            hd_mode: hdMode
        }) + '\n';
        
        let responseBuffer = '';
        
        const onData = (data) => {
            responseBuffer += data.toString();
            const lines = responseBuffer.split('\n');
            responseBuffer = lines.pop();
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const result = JSON.parse(line);
                        birefnetServer.stdout.off('data', onData);
                        resolve(result);
                        return;
                    } catch (e) {
                        // Continue waiting for valid JSON
                    }
                }
            }
        };
        
        birefnetServer.stdout.on('data', onData);
        birefnetServer.stdin.write(cmd);
    });
}

// Start server when app is ready
app.whenReady().then(() => {
    startBiRefNetServer();
});

// Clean up server on exit
app.on('before-quit', () => {
    if (birefnetServer) {
        birefnetServer.stdin.write('{"action":"exit"}\n');
        setTimeout(() => {
            if (birefnetServer) birefnetServer.kill();
        }, 1000);
    }
});

// IPC handler for device info
ipcMain.handle('get-device-info', () => {
    return deviceInfo;
});

// Get the correct resource path for background removal library
function getResourcePath() {
    if (app.isPackaged) {
        // In production, resources are in extraResources folder
        return path.join(process.resourcesPath, 'bg-removal-resources');
    } else {
        // In development, use node_modules directly
        return path.join(__dirname, 'node_modules', '@imgly', 'background-removal-node', 'dist');
    }
}

// Resize large images to prevent OOM crashes (returns temp file path or original)
async function resizeIfNeeded(filePath, maxDimension = 4096) {
    try {
        const sharp = require('sharp');
        const metadata = await sharp(filePath).metadata();
        
        if (!metadata.width || !metadata.height) return filePath;
        
        const maxDim = Math.max(metadata.width, metadata.height);
        if (maxDim <= maxDimension) return filePath;
        
        // Resize to temp file
        const os = require('os');
        const tempPath = path.join(os.tmpdir(), `bg-remover-resized-${Date.now()}.png`);
        
        await sharp(filePath)
            .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toFile(tempPath);
        
        console.log(`Resized ${metadata.width}x${metadata.height} -> ${maxDimension}px max for processing`);
        return tempPath;
    } catch (e) {
        // sharp not available or error - continue with original
        console.log('Resize check skipped:', e.message);
        return filePath;
    }
}

// Handle background removal using persistent Python BiRefNet server
// Supports hdMode: true (high quality) or false (speed mode)
ipcMain.handle('remove-background', async (event, { filePath, hdMode }) => {
    // Prevent concurrent processing
    if (isProcessing) {
        return { success: false, error: 'Another image is being processed. Please wait.' };
    }
    
    isProcessing = true;
    const startTime = Date.now();
    const modeName = hdMode ? 'HD' : 'Speed';
    
    try {
        // Check file size
        const fileStats = fs.statSync(filePath);
        const fileSizeMB = fileStats.size / (1024 * 1024);
        console.log(`[${modeName}] Processing image: ${filePath} (${fileSizeMB.toFixed(1)}MB)`);
        console.log('Device:', deviceInfo.gpuName, '| Platform:', deviceInfo.platform);
        console.log('Using persistent BiRefNet server');
        
        // Wait for server to be ready (max 60s on first run for model download)
        let waitTime = 0;
        while (!serverReady && waitTime < 60000) {
            await new Promise(r => setTimeout(r, 500));
            waitTime += 500;
        }
        
        if (!serverReady) {
            throw new Error('BiRefNet server failed to start. Check Python dependencies.');
        }
        
        // Process via persistent server
        const result = await processWithServer(filePath, hdMode);
        
        if (!result.success) {
            throw new Error(result.error || 'Processing failed');
        }
        
        const resultBase64 = `data:image/webp;base64,${result.data}`;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`✅ [${modeName}] Total: ${elapsed}s (Processing: ${result.time}s), size: ${(result.data.length * 0.75 / 1024).toFixed(1)}KB`);
        
        isProcessing = false;
        return { success: true, data: resultBase64 };
        
    } catch (error) {
        console.error('❌ Background removal error:', error);
        isProcessing = false;
        
        // User-friendly errors
        let userError = error.message;
        if (error.message.includes('python') || error.message.includes('Python')) {
            userError = 'Python is not installed. Please install Python 3.8+ from python.org';
        } else if (error.message.includes('No module named')) {
            userError = 'Missing Python packages. Run: pip install torch torchvision pillow numpy transformers einops kornia';
        } else if (error.message.includes('memory') || error.message.includes('OOM')) {
            userError = 'Image too large for memory. Try Speed mode.';
        }
        
        return { success: false, error: userError };
    }
});
