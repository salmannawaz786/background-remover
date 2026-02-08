const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const os = require('os');
const Store = require('electron-store');
const { setupAuthHandlers, setCurrentUser } = require('./auth.js');

// Keep a global reference of the window object
let mainWindow;
let pythonProcess = null;
const isDev = process.argv.includes('--dev');
const store = new Store();

// Get resource paths based on environment
function getResourcePath(relativePath) {
    if (isDev) {
        return path.join(__dirname, relativePath);
    }
    // In production, try multiple possible locations
    const possiblePaths = [
        path.join(process.resourcesPath, relativePath),
        path.join(__dirname, relativePath),
        path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    
    // Return the default path if none found
    return path.join(process.resourcesPath, relativePath);
}

// App version
const APP_VERSION = '1.0.0';
const APP_NAME = 'SalluLabs Watermark Remover';

// Detect GPU capabilities (NVIDIA CUDA, Apple MPS, AMD/Intel DirectML)
function detectGPU() {
    const gpuInfo = {
        hasGPU: false,
        hasCUDA: false,
        hasMPS: false,
        hasDirectML: false,
        gpuName: 'Unknown',
        recommendation: 'cpu'
    };

    try {
        // 1) Check for NVIDIA GPU (CUDA) – Windows & Linux
        if (process.platform !== 'darwin') {
            try {
                const result = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { 
                    encoding: 'utf8', 
                    timeout: 5000,
                    stdio: ['pipe', 'pipe', 'ignore']
                });
                if (result.trim()) {
                    gpuInfo.hasGPU = true;
                    gpuInfo.hasCUDA = true;
                    gpuInfo.gpuName = result.trim().split('\n')[0];
                    gpuInfo.recommendation = 'cuda';
                    return gpuInfo; // CUDA is best, stop here
                }
            } catch (e) { /* No NVIDIA GPU */ }
        }

        // 2) Check for Apple Silicon (MPS)
        if (process.platform === 'darwin') {
            try {
                const result = execSync('sysctl -n machdep.cpu.brand_string', { 
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                });
                if (result.includes('Apple')) {
                    gpuInfo.hasGPU = true;
                    gpuInfo.hasMPS = true;
                    gpuInfo.gpuName = 'Apple Silicon';
                    gpuInfo.recommendation = 'mps';
                    return gpuInfo;
                }
            } catch (e) { /* Not Apple Silicon */ }
        }

        // 3) Check for AMD / Intel GPU (DirectML on Windows)
        if (process.platform === 'win32') {
            try {
                const result = execSync(
                    'wmic path win32_VideoController get Name /format:list',
                    { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
                );
                const names = result.split('\n')
                    .map(l => l.replace('Name=', '').trim())
                    .filter(l => l.length > 0);
                const amdOrIntel = names.find(n => /AMD|Radeon|Intel.*Arc|Intel.*Iris/i.test(n));
                if (amdOrIntel) {
                    gpuInfo.hasGPU = true;
                    gpuInfo.hasDirectML = true;
                    gpuInfo.gpuName = amdOrIntel;
                    gpuInfo.recommendation = 'directml';
                    return gpuInfo;
                }
            } catch (e) { /* No AMD/Intel GPU detected */ }
        }
    } catch (e) {
        // Silent fail - GPU detection is optional
    }

    return gpuInfo;
}

// Check if Python is available (cached after first call)
let _cachedPythonCmd = undefined; // undefined = not checked yet, null = not found
function checkPython() {
    if (_cachedPythonCmd !== undefined) return _cachedPythonCmd;

    // On Windows, try these in order
    const pythonCommands = process.platform === 'win32' 
        ? ['python', 'py', 'python3']
        : ['python3', 'python', 'py'];
    
    for (const cmd of pythonCommands) {
        try {
            const result = execSync(`${cmd} --version`, { 
                encoding: 'utf8', 
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
                windowsHide: true
            });
            if (result.includes('Python 3')) {
                _cachedPythonCmd = cmd;
                return cmd;
            }
        } catch (e) {
            continue;
        }
    }
    _cachedPythonCmd = null;
    return null;
}

// Create the browser window - now accepts initial page parameter
function createWindow(initialPage = null) {
    // Check if user is authenticated
    const savedUser = store.get('user');
    const savedToken = store.get('token');
    const isAuthenticated = !!(savedUser && savedToken);
    
    // Determine which page to load
    const pageToLoad = initialPage || (isAuthenticated ? 'renderer/index.html' : 'auth.html');
    
    // Restore saved session to auth module
    if (isAuthenticated) {
        setCurrentUser(savedUser, savedToken);
    }
    // Get icon path
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        title: APP_NAME,
        icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true
        },
        backgroundColor: '#fcfcfc',
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        frame: true
    });

    // Load the determined page directly (no flash)
    mainWindow.loadFile(pageToLoad);

    // Show when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Open DevTools in dev mode
        if (isDev) {
            mainWindow.webContents.openDevTools();
        }
    });

    // Pre-load LaMa model when navigating to main app (after auth)
    mainWindow.webContents.on('did-navigate', (event, url) => {
        if (url.includes('renderer/index.html') && !preloadProcess) {
            console.log('Navigated to main app, preloading model...');
            preloadModel();
        }
    });

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindow = null;
        // Kill Python process if running
        if (pythonProcess) {
            pythonProcess.kill();
            pythonProcess = null;
        }
        if (preloadProcess) {
            preloadProcess.kill();
            preloadProcess = null;
        }
    });

    // Create application menu - disabled for cleaner UI
    Menu.setApplicationMenu(null);
}

// Pre-load the LaMa model on startup so the first image processes instantly
let preloadProcess = null;
function preloadModel() {
    const pythonCmd = checkPython();
    if (!pythonCmd) return;

    const pythonScript = getResourcePath('python/inpaint.py');
    if (!fs.existsSync(pythonScript)) return;

    const modelPath = getResourcePath('models/big-lama.pt');
    const args = [pythonScript, '--preload', '--device', 'auto'];
    if (fs.existsSync(modelPath)) args.push('--model', modelPath);

    preloadProcess = spawn(pythonCmd, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    preloadProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('MODEL_READY:')) {
                if (mainWindow) mainWindow.webContents.send('model-ready', trimmed.split(':')[1]);
            }
        });
    });

    preloadProcess.on('close', () => {
        preloadProcess = null;
    });

    preloadProcess.on('error', () => {
        preloadProcess = null;
        if (mainWindow) mainWindow.webContents.send('model-ready', 'fallback');
    });
}

// Create application menu
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Image',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        mainWindow.webContents.send('menu-open-image');
                    }
                },
                {
                    label: 'Save Result',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('menu-save-result');
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => {
                        mainWindow.webContents.send('menu-undo');
                    }
                },
                {
                    label: 'Clear Mask',
                    accelerator: 'CmdOrCtrl+Shift+C',
                    click: () => {
                        mainWindow.webContents.send('menu-clear-mask');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reset Image',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.webContents.send('menu-reset');
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About',
                            message: APP_NAME,
                            detail: `Version ${APP_VERSION}\n\nAI-powered watermark and object remover.\nPowered by Samsung's LaMa AI Model.\n\n© 2025 SalluLabs`
                        });
                    }
                },
                {
                    label: 'Visit Website',
                    click: () => {
                        shell.openExternal('https://sallulabs.com');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        }
    ];

    // macOS specific menu items
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        });
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// App ready
app.whenReady().then(() => {
    // Setup authentication handlers
    setupAuthHandlers(store);
    
    // Restore user session if saved
    const savedUser = store.get('user');
    const savedToken = store.get('token');
    if (savedUser && savedToken) {
        setCurrentUser(savedUser, savedToken);
    }
    
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers

// Get app info
ipcMain.handle('get-app-info', () => {
    return {
        name: APP_NAME,
        version: APP_VERSION,
        platform: process.platform,
        arch: process.arch
    };
});

// Get GPU info
ipcMain.handle('get-gpu-info', () => {
    return detectGPU();
});

// Check Python availability
ipcMain.handle('check-python', () => {
    const pythonCmd = checkPython();
    return {
        available: pythonCmd !== null,
        command: pythonCmd
    };
});

// Open file dialog
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileBuffer = fs.readFileSync(filePath);
        const base64 = fileBuffer.toString('base64');
        const ext = path.extname(filePath).toLowerCase().slice(1);
        const mimeType = ext === 'jpg' ? 'jpeg' : ext;
        
        return {
            success: true,
            data: `data:image/${mimeType};base64,${base64}`,
            path: filePath,
            name: path.basename(filePath)
        };
    }

    return { success: false };
});

// Save file dialog
ipcMain.handle('save-file-dialog', async (event, imageData) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: 'removed_watermark.png',
        filters: [
            { name: 'PNG Image', extensions: ['png'] },
            { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        try {
            // Remove data URL prefix
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(result.filePath, buffer);
            return { success: true, path: result.filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    return { success: false };
});

// Helper: parse structured stdout lines from Python backend
function parsePythonOutput(data, windowRef) {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('PROGRESS:')) {
            const progress = parseInt(trimmed.split(':')[1]);
            if (windowRef) windowRef.webContents.send('processing-progress', progress);
        } else if (trimmed.startsWith('STATUS:')) {
            const status = trimmed.substring(7);
            if (windowRef) windowRef.webContents.send('processing-status', status);
        } else if (trimmed.startsWith('BATCH_INDEX:')) {
            const idx = parseInt(trimmed.split(':')[1]);
            if (windowRef) windowRef.webContents.send('batch-index', idx);
        } else if (trimmed.startsWith('BATCH_ITEM_DONE:')) {
            try {
                const payload = JSON.parse(trimmed.substring(16));
                if (windowRef) windowRef.webContents.send('batch-item-done', payload);
            } catch (e) { /* ignore parse errors */ }
        } else if (trimmed.startsWith('BATCH_COMPLETE:')) {
            const total = parseInt(trimmed.split(':')[1]);
            if (windowRef) windowRef.webContents.send('batch-complete', total);
        }
    });
}

// Helper: spawn Python for inpainting with given args
function spawnPython(args) {
    const pythonCmd = checkPython();
    if (!pythonCmd) return { error: 'Python 3 is not installed. Please install Python 3.8+.' };

    const pythonScript = getResourcePath('python/inpaint.py');
    if (!fs.existsSync(pythonScript)) return { error: 'Processing script not found.' };

    const modelPath = getResourcePath('models/big-lama.pt');
    const fullArgs = [pythonScript, ...args];
    if (fs.existsSync(modelPath)) fullArgs.push('--model', modelPath);
    return { pythonCmd, fullArgs };
}

// Process single image with Python backend
ipcMain.handle('process-image', async (event, { imageData, maskData, device }) => {
    return new Promise((resolve) => {
        const setup = spawnPython([
            '--device', device || 'auto'
        ]);
        if (setup.error) { resolve({ success: false, error: setup.error }); return; }

        const tempDir = os.tmpdir();
        const ts = Date.now();
        const imageFile = path.join(tempDir, `wm_in_${ts}.png`);
        const maskFile = path.join(tempDir, `wm_mask_${ts}.png`);
        const outputFile = path.join(tempDir, `wm_out_${ts}.png`);

        try {
            fs.writeFileSync(imageFile, Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
            fs.writeFileSync(maskFile, Buffer.from(maskData.replace(/^data:image\/\w+;base64,/, ''), 'base64'));

            const finalArgs = [
                ...setup.fullArgs,
                '--image', imageFile,
                '--mask', maskFile,
                '--output', outputFile,
                '--quality', '97'
            ];

            pythonProcess = spawn(setup.pythonCmd, finalArgs, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stderr = '';

            pythonProcess.stdout.on('data', (data) => parsePythonOutput(data, mainWindow));
            pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

            pythonProcess.on('close', (code) => {
                pythonProcess = null;
                try { fs.unlinkSync(imageFile); } catch (e) {}
                try { fs.unlinkSync(maskFile); } catch (e) {}

                if (code === 0 && fs.existsSync(outputFile)) {
                    try {
                        const outputBase64 = fs.readFileSync(outputFile).toString('base64');
                        fs.unlinkSync(outputFile);
                        resolve({ success: true, data: `data:image/png;base64,${outputBase64}` });
                    } catch (e) {
                        resolve({ success: false, error: `Failed to read output: ${e.message}` });
                    }
                } else {
                    resolve({ success: false, error: stderr || `Process exited with code ${code}` });
                }
            });

            pythonProcess.on('error', (error) => {
                pythonProcess = null;
                resolve({ success: false, error: `Failed to start Python: ${error.message}` });
            });
        } catch (error) {
            resolve({ success: false, error: error.message });
        }
    });
});

// Open batch file dialog (up to 50 images)
ipcMain.handle('open-batch-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
    }

    // Limit to 50 images
    const filePaths = result.filePaths.slice(0, 50);
    const items = filePaths.map(fp => {
        const fileBuffer = fs.readFileSync(fp);
        const ext = path.extname(fp).toLowerCase().slice(1);
        const mimeType = ext === 'jpg' ? 'jpeg' : ext;
        return {
            path: fp,
            name: path.basename(fp),
            data: `data:image/${mimeType};base64,${fileBuffer.toString('base64')}`
        };
    });

    return { success: true, items };
});

// Process batch of images
ipcMain.handle('process-batch', async (event, { items, device }) => {
    // items = [{ imageData, maskData, originalName }, ...]
    const setup = spawnPython(['--device', device || 'auto']);
    if (setup.error) return { success: false, error: setup.error };

    const tempDir = os.tmpdir();
    const ts = Date.now();
    const manifest = [];

    // Write all images/masks to temp files
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const imgFile = path.join(tempDir, `wm_batch_img_${ts}_${i}.png`);
        const maskFile = path.join(tempDir, `wm_batch_mask_${ts}_${i}.png`);
        const outFile = path.join(tempDir, `wm_batch_out_${ts}_${i}.png`);

        fs.writeFileSync(imgFile, Buffer.from(item.imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        fs.writeFileSync(maskFile, Buffer.from(item.maskData.replace(/^data:image\/\w+;base64,/, ''), 'base64'));

        manifest.push({ image: imgFile, mask: maskFile, output: outFile });
    }

    const manifestPath = path.join(tempDir, `wm_batch_manifest_${ts}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    return new Promise((resolve) => {
        const finalArgs = [
            ...setup.fullArgs,
            '--batch', manifestPath,
            '--quality', '97'
        ];

        pythonProcess = spawn(setup.pythonCmd, finalArgs, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';

        pythonProcess.stdout.on('data', (data) => parsePythonOutput(data, mainWindow));
        pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

        pythonProcess.on('close', (code) => {
            pythonProcess = null;

            // Read all outputs
            const results = manifest.map((m, i) => {
                if (fs.existsSync(m.output)) {
                    const b64 = fs.readFileSync(m.output).toString('base64');
                    try { fs.unlinkSync(m.output); } catch (e) {}
                    return { index: i, success: true, data: `data:image/png;base64,${b64}` };
                }
                return { index: i, success: false };
            });

            // Cleanup temp files
            manifest.forEach(m => {
                try { fs.unlinkSync(m.image); } catch (e) {}
                try { fs.unlinkSync(m.mask); } catch (e) {}
            });
            try { fs.unlinkSync(manifestPath); } catch (e) {}

            resolve({ success: code === 0, results, error: code !== 0 ? stderr : undefined });
        });

        pythonProcess.on('error', (error) => {
            pythonProcess = null;
            resolve({ success: false, error: `Failed to start Python: ${error.message}` });
        });
    });
});

// Save a single batch result file
ipcMain.handle('save-batch-file', async (event, { imageData, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName || 'result.png',
        filters: [
            { name: 'PNG Image', extensions: ['png'] },
            { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        try {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
            return { success: true, path: result.filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    return { success: false };
});

// Cancel processing
ipcMain.handle('cancel-processing', () => {
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
        return { success: true };
    }
    return { success: false };
});

// Get system info
ipcMain.handle('get-system-info', () => {
    return {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
        freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron
    };
});
