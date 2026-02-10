const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Auto-update methods
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info)),
    onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, progress) => callback(progress)),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    
    selectImage: () => ipcRenderer.invoke('select-image'),
    selectImages: () => ipcRenderer.invoke('select-images'),
    saveImage: (data, defaultName) => ipcRenderer.invoke('save-image', { data, defaultName }),
    removeBackground: (filePath, hdMode) => ipcRenderer.invoke('remove-background', { filePath, hdMode: hdMode || false }),
    onProgress: (callback) => ipcRenderer.on('processing-progress', (event, data) => callback(data)),
    onModelReady: (callback) => ipcRenderer.on('model-ready', (event, status) => callback(status)),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
    
    // Cloudflare R2 Storage
    uploadToR2: (imageData, filename) => ipcRenderer.invoke('upload-to-r2', { imageData, filename }),
    
    // Authentication APIs
    auth: {
        getState: () => ipcRenderer.invoke('auth-get-state'),
        setUser: (user, token) => ipcRenderer.invoke('auth-set-user', { user, token }),
        logout: () => ipcRenderer.invoke('auth-logout'),
        getToken: () => ipcRenderer.invoke('auth-get-token'),
        googleSignIn: () => ipcRenderer.invoke('auth-google-signin')
    }
});
