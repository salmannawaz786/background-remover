const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const { setupAuthHandlers, getCurrentUser, setCurrentUser } = require('./auth');

// Initialize persistent store
const store = new Store({
    encryptionKey: 'sallulabs-bg-remover-secure-key-2024'
});

let mainWindow;

// Enable GPU acceleration and improve stability
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

// Memory management for stability
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

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
    endpoint: process.env.R2_ENDPOINT || 'https://6985a0a8491427aee57107f93794a7fa.r2.cloudflarestorage.com',
    accessKeyId: process.env.R2_ACCESS_KEY || 'a45b9c58b21460d9f58ee072d46dddba',
    secretAccessKey: process.env.R2_SECRET_KEY || 'ae17604ead6b2eb5a253812227c9ac48d86706e3790a61f372e86fdc50a82f3e',
    bucketName: process.env.R2_BUCKET_NAME || 'sallulabs-images',
    publicDomain: process.env.R2_PUBLIC_DOMAIN || ''
};

// R2 upload handler
ipcMain.handle('upload-to-r2', async (event, { imageData, filename }) => {
    try {
        // Check if R2 is configured
        if (R2_CONFIG.accessKeyId === 'YOUR_R2_ACCESS_KEY') {
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
ipcMain.handle('remove-background', async (event, filePath) => {
    // Prevent concurrent processing which can cause crashes
    if (isProcessing) {
        return { success: false, error: 'Another image is being processed. Please wait.' };
    }
    
    isProcessing = true;
    
    try {
        const { removeBackground } = await import('@imgly/background-removal-node');
        
        console.log('Processing image:', filePath);
        console.log('App packaged:', app.isPackaged);
        
        // Convert Windows path to file:// URL format
        const { pathToFileURL } = require('url');
        const fileURL = pathToFileURL(filePath).href;
        console.log('File URL:', fileURL);
        
        // Get resource path based on environment
        const resourcePath = getResourcePath();
        console.log('Resource path:', resourcePath);
        
        // Pass file URL with optimized settings and correct resource path
        const resultBlob = await removeBackground(fileURL, {
            publicPath: `file://${resourcePath}/`,
            progress: (key, current, total) => {
                // Send progress updates - callback MUST return void (not Promise)
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('processing-progress', { key, current, total });
                }
            },
            output: {
                format: 'image/png',
                quality: 1.0  // Maximum quality - original HD
            }
        });
        
        // Convert result to base64
        const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());
        const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;
        
        console.log('✅ Successfully processed image, buffer size:', (resultBuffer.length / 1024).toFixed(2), 'KB');
        
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
