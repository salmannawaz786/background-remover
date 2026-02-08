const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    
    // GPU detection
    getGPUInfo: () => ipcRenderer.invoke('get-gpu-info'),
    
    // Python check
    checkPython: () => ipcRenderer.invoke('check-python'),
    
    // File operations
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    saveFileDialog: (imageData) => ipcRenderer.invoke('save-file-dialog', imageData),
    
    // Image processing
    processImage: (data) => ipcRenderer.invoke('process-image', data),
    cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),
    
    // Batch processing
    openBatchDialog: () => ipcRenderer.invoke('open-batch-dialog'),
    processBatch: (data) => ipcRenderer.invoke('process-batch', data),
    saveBatchFile: (data) => ipcRenderer.invoke('save-batch-file', data),
    
    // System info
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    
    // Menu event listeners
    onMenuOpenImage: (callback) => ipcRenderer.on('menu-open-image', callback),
    onMenuSaveResult: (callback) => ipcRenderer.on('menu-save-result', callback),
    onMenuUndo: (callback) => ipcRenderer.on('menu-undo', callback),
    onMenuClearMask: (callback) => ipcRenderer.on('menu-clear-mask', callback),
    onMenuReset: (callback) => ipcRenderer.on('menu-reset', callback),
    
    // Processing event listeners
    onProcessingProgress: (callback) => ipcRenderer.on('processing-progress', (event, progress) => callback(progress)),
    onProcessingStatus: (callback) => ipcRenderer.on('processing-status', (event, status) => callback(status)),
    
    // Model preload
    onModelReady: (callback) => ipcRenderer.on('model-ready', (event, status) => callback(status)),

    // Batch event listeners
    onBatchIndex: (callback) => ipcRenderer.on('batch-index', (event, idx) => callback(idx)),
    onBatchItemDone: (callback) => ipcRenderer.on('batch-item-done', (event, payload) => callback(payload)),
    onBatchComplete: (callback) => ipcRenderer.on('batch-complete', (event, total) => callback(total)),
    
    // Authentication APIs
    auth: {
        getState: () => ipcRenderer.invoke('auth-get-state'),
        setUser: (user, token) => ipcRenderer.invoke('auth-set-user', { user, token }),
        logout: () => ipcRenderer.invoke('auth-logout'),
        getToken: () => ipcRenderer.invoke('auth-get-token'),
        googleSignIn: () => ipcRenderer.invoke('auth-google-signin')
    },
    
    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Log when preload is loaded
console.log('Preload script loaded successfully');
