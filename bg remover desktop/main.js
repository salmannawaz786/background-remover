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
        
        // Dynamic import for AWS SDK
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        
        // Initialize S3 client for R2
        const s3Client = new S3Client({
            region: 'auto',
            endpoint: R2_CONFIG.endpoint,
            credentials: {
                accessKeyId: R2_CONFIG.accessKeyId,
                secretAccessKey: R2_CONFIG.secretAccessKey
            }
        });
        
        // Convert blob/base64 to buffer
        let buffer;
        if (typeof imageData === 'string' && imageData.startsWith('data:')) {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(base64Data, 'base64');
        } else if (imageData instanceof ArrayBuffer) {
            buffer = Buffer.from(imageData);
        } else {
            buffer = Buffer.from(await imageData.arrayBuffer());
        }
        
        // Upload to R2
        const command = new PutObjectCommand({
            Bucket: R2_CONFIG.bucketName,
            Key: filename,
            Body: buffer,
            ContentType: 'image/png'
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

// Handle background removal using file path directly (non-blocking)
// Supports hdMode: true (high quality) or false (speed mode)
ipcMain.handle('remove-background', async (event, { filePath, hdMode }) => {
    // Prevent concurrent processing which can cause crashes
    if (isProcessing) {
        return { success: false, error: 'Another image is being processed. Please wait.' };
    }
    
    isProcessing = true;
    const startTime = Date.now();
    const modeName = hdMode ? 'HD' : 'Speed';
    
    try {
        const { removeBackground } = await import('@imgly/background-removal-node');
        
        console.log(`[${modeName}] Processing image:`, filePath);
        console.log('Device:', deviceInfo.gpuName, '| Platform:', deviceInfo.platform, '| Arch:', deviceInfo.arch);
        
        // Convert Windows path to file:// URL format
        const { pathToFileURL } = require('url');
        const fileURL = pathToFileURL(filePath).href;
        
        // Get resource path based on environment
        const resourcePath = getResourcePath();
        
        // Configure based on Speed vs HD mode
        const config = {
            publicPath: `file://${resourcePath}/`,
            progress: (key, current, total) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('processing-progress', { key, current, total });
                }
            },
            output: {
                format: 'image/png',
                quality: hdMode ? 1.0 : 0.8
            }
        };
        
        // Speed mode: use smaller model for faster processing
        if (!hdMode) {
            config.model = 'small';
        }
        
        // Device-specific optimizations
        if (deviceInfo.isAppleSilicon) {
            // Apple Silicon: CoreML acceleration via ONNX Runtime
            config.device = 'gpu';
            console.log('Using Apple Silicon Metal/CoreML acceleration');
        } else if (deviceInfo.hasNvidiaGpu) {
            // NVIDIA: CUDA acceleration
            config.device = 'gpu';
            console.log(`Using NVIDIA CUDA acceleration: ${deviceInfo.gpuName}`);
        } else {
            config.device = 'cpu';
            console.log(`Using CPU (${deviceInfo.cpuCores} cores)`);
        }
        
        const resultBlob = await removeBackground(fileURL, config);
        
        // Convert result to base64
        const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());
        const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [${modeName}] Processed in ${elapsed}s, size: ${(resultBuffer.length / 1024).toFixed(1)}KB`);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        isProcessing = false;
        return { success: true, data: resultBase64 };
    } catch (error) {
        console.error('❌ Background removal error:', error);
        isProcessing = false;
        
        // Force garbage collection on error too
        if (global.gc) {
            global.gc();
        }
        
        return { success: false, error: error.message };
    }
});
