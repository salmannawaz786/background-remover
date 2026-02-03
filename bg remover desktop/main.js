const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const { setupAuthHandlers, getCurrentUser, setCurrentUser } = require('./auth');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

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
        icon: process.platform === 'win32' 
            ? path.join(__dirname, 'assets', 'icon.ico')
            : path.join(__dirname, 'assets', 'icon.png'),
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#1a1a1a',
        autoHideMenuBar: true,
        frame: true
    });
    
    // Hide menu bar completely on Windows
    if (process.platform === 'win32') {
        mainWindow.setMenuBarVisibility(false);
        mainWindow.setMenu(null);
    }

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
autoUpdater.autoDownload = true;  // Auto-download updates
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

function checkForUpdates() {
    console.log('🔍 Checking for updates...');
    console.log('Current version:', app.getVersion());
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('Update check failed:', err);
    });
}

autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for update...');
});

autoUpdater.on('update-available', (info) => {
    console.log('✅ Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info);
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('ℹ️ No update available. Current version is latest:', info.version);
});

autoUpdater.on('download-progress', (progressObj) => {
    console.log(`📥 Download progress: ${progressObj.percent.toFixed(1)}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', progressObj);
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Cloudflare R2 Configuration (loaded from store or environment)
function getR2Client() {
    const r2Config = store.get('r2Config') || {};
    if (!r2Config.endpoint || !r2Config.accessKey || !r2Config.secretKey) {
        return null;
    }
    return new S3Client({
        region: 'auto',
        endpoint: r2Config.endpoint,
        credentials: {
            accessKeyId: r2Config.accessKey,
            secretAccessKey: r2Config.secretKey
        }
    });
}

// IPC handler to save R2 configuration
ipcMain.handle('save-r2-config', async (event, config) => {
    try {
        store.set('r2Config', {
            endpoint: config.endpoint,
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            bucketName: config.bucketName,
            publicUrl: config.publicUrl || ''
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC handler to get R2 configuration
ipcMain.handle('get-r2-config', async () => {
    const config = store.get('r2Config') || {};
    return {
        configured: !!(config.endpoint && config.accessKey && config.secretKey && config.bucketName),
        endpoint: config.endpoint || '',
        bucketName: config.bucketName || '',
        publicUrl: config.publicUrl || ''
    };
});

// IPC handler to upload processed image to R2
ipcMain.handle('upload-to-r2', async (event, { imageData, fileName }) => {
    try {
        const r2Config = store.get('r2Config');
        if (!r2Config || !r2Config.endpoint || !r2Config.accessKey || !r2Config.secretKey || !r2Config.bucketName) {
            return { success: false, error: 'R2 not configured' };
        }

        const s3Client = new S3Client({
            region: 'auto',
            endpoint: r2Config.endpoint,
            credentials: {
                accessKeyId: r2Config.accessKey,
                secretAccessKey: r2Config.secretKey
            }
        });

        // Convert base64 to buffer
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate unique filename
        const timestamp = Date.now();
        const uniqueFileName = `bg-removed/${timestamp}_${fileName}`;

        const command = new PutObjectCommand({
            Bucket: r2Config.bucketName,
            Key: uniqueFileName,
            Body: buffer,
            ContentType: 'image/png'
        });

        await s3Client.send(command);
        
        // Generate public URL
        const publicUrl = r2Config.publicUrl 
            ? `${r2Config.publicUrl}/${uniqueFileName}`
            : `https://${r2Config.bucketName}.r2.dev/${uniqueFileName}`;

        console.log('✅ Image uploaded to R2:', publicUrl);
        return { success: true, url: publicUrl, key: uniqueFileName };
    } catch (error) {
        console.error('❌ R2 upload error:', error);
        return { success: false, error: error.message };
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
