const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Auto-update methods
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info)),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    
    selectImage: () => ipcRenderer.invoke('select-image'),
    selectImages: () => ipcRenderer.invoke('select-images'),
    saveImage: (data, defaultName) => ipcRenderer.invoke('save-image', { data, defaultName }),
    removeBackground: (imageData) => ipcRenderer.invoke('remove-background', imageData),
    onProgress: (callback) => ipcRenderer.on('processing-progress', (event, data) => callback(data)),
    
    // Authentication APIs
    auth: {
        getState: () => ipcRenderer.invoke('auth-get-state'),
        setUser: (user, token) => ipcRenderer.invoke('auth-set-user', { user, token }),
        logout: () => ipcRenderer.invoke('auth-logout'),
        getToken: () => ipcRenderer.invoke('auth-get-token'),
        googleSignIn: () => ipcRenderer.invoke('auth-google-signin')
    }
});
