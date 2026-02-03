// Firebase Storage upload - runs in background
async function uploadToFirebaseStorage(imageData, filename) {
    console.log('🔄 Starting Firebase upload...');
    
    try {
        // Check online
        if (!navigator.onLine) {
            console.log('⚠️ Offline - skipping');
            return null;
        }
        
        // Check Firebase
        if (!window.firebaseStorage) {
            console.error('❌ Firebase Storage not initialized');
            return null;
        }
        
        const { storage, ref, uploadBytes, getDownloadURL } = window.firebaseStorage;
        
        // Get user - try multiple sources
        let userUid, userEmail;
        
        // 1. Try Firebase Auth user
        if (window.firebaseAuthUser) {
            userUid = window.firebaseAuthUser.uid;
            userEmail = window.firebaseAuthUser.email;
            console.log('✓ Using Firebase Auth user');
        }
        // 2. Try stored user from localStorage
        else if (window.firebaseUser) {
            userUid = window.firebaseUser.uid;
            userEmail = window.firebaseUser.email;
            console.log('✓ Using stored user session');
        }
        // 3. Try Electron auth state
        else {
            const authState = await window.electronAPI.auth.getState();
            if (authState.isAuthenticated && authState.user) {
                userUid = authState.user.uid;
                userEmail = authState.user.email;
                console.log('✓ Using Electron auth state');
            }
        }
        
        if (!userUid) {
            console.log('⚠️ No user found - skipping upload');
            return null;
        }
        
        console.log('✓ User:', userEmail, 'UID:', userUid);
        
        // Convert to blob
        const response = await fetch(imageData);
        const blob = await response.blob();
        console.log('✓ Blob size:', (blob.size / 1024).toFixed(2), 'KB');
        
        // Storage path
        const timestamp = Date.now();
        const storagePath = `users/${userUid}/processed/${timestamp}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        console.log('✓ Path:', storagePath);
        
        // Create reference and upload
        const storageRef = ref(storage, storagePath);
        
        console.log('📤 Uploading...');
        const uploadResult = await uploadBytes(storageRef, blob, {
            contentType: 'image/png'
        });
        
        const downloadURL = await getDownloadURL(uploadResult.ref);
        console.log('✅ SUCCESS:', downloadURL);
        
        return downloadURL;
        
    } catch (error) {
        console.error('❌ Upload failed:', error.code || error.message);
        
        // Log specific Firebase errors
        if (error.code === 'storage/unauthorized') {
            console.error('⚠️ Storage rules deny access. Check Firebase Console → Storage → Rules');
        } else if (error.code === 'storage/unauthenticated') {
            console.error('⚠️ User not authenticated with Firebase. Check auth flow.');
        }
        
        return null;
    }
}

// Check authentication on load - MANDATORY
window.addEventListener('DOMContentLoaded', async () => {
    const authState = await window.electronAPI.auth.getState();
    
    if (!authState.isAuthenticated) {
        window.location.href = 'auth.html';
        return;
    }
    
    // Display user info
    const userInfo = document.getElementById('user-info');
    if (userInfo && authState.user) {
        userInfo.textContent = authState.user.email;
        userInfo.style.display = 'block';
    }
});

// DOM Elements
const uploadArea = document.getElementById('upload-area');
const uploadBtn = document.getElementById('upload-btn');
const processing = document.getElementById('processing');
const resultsContainer = document.getElementById('results-container');
const batchContainer = document.getElementById('batch-container');
const batchGrid = document.getElementById('batch-grid');
const originalImage = document.getElementById('original-image');
const resultImage = document.getElementById('result-image');
const downloadBtn = document.getElementById('download-btn');
const newImageBtn = document.getElementById('new-image-btn');
const newBatchBtn = document.getElementById('new-batch-btn');
const processBatchBtn = document.getElementById('process-batch-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const themeToggle = document.getElementById('theme-toggle');

let currentMode = 'single';
let batchImages = [];
let processedImages = [];

// Logout functionality
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await window.electronAPI.auth.logout();
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        window.location.href = 'auth.html';
    });
}

// Theme Toggle
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
});

// Load saved theme
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
}

// Mode Selection
modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        resetUI();
    });
});

// Upload Area Click
uploadArea.addEventListener('click', () => selectImage());
uploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectImage();
});

// Drag and Drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    // Note: File drop in Electron requires using dialog API
    // Direct file drops are handled through selectImage() instead
});

// Select Image
async function selectImage() {
    if (currentMode === 'single') {
        const image = await window.electronAPI.selectImage();
        if (image) {
            processSingleImage(image);
        }
    } else {
        const images = await window.electronAPI.selectImages();
        if (images.length > 0) {
            images.forEach(img => addToBatch(img));
            showBatchUI();
        }
    }
}

// Process Single Image
async function processSingleImage(image) {
    console.log('Starting to process single image:', image.name);
    uploadArea.style.display = 'none';
    processing.style.display = 'block';
    
    // Set original image
    originalImage.src = image.data;
    console.log('Set original image');
    
    try {
        // Pass file path instead of base64 data
        console.log('Calling removeBackground with path:', image.path);
        const result = await window.electronAPI.removeBackground(image.path);
        
        console.log('Result received:', result.success ? 'Success' : 'Failed');
        
        if (result.success) {
            console.log('Setting result image, data length:', result.data ? result.data.length : 0);
            resultImage.src = result.data;
            processing.style.display = 'none';
            resultsContainer.style.display = 'block';
            console.log('UI updated - results should be visible');
            
            // Upload to R2 Storage in background (don't await, don't block UI)
            setTimeout(async () => {
                try {
                    const r2Config = await window.electronAPI.r2.getConfig();
                    if (r2Config.configured) {
                        const fileName = image.name.replace(/\.[^.]+$/, '') + '_no_bg.png';
                        const uploadResult = await window.electronAPI.r2.upload(result.data, fileName);
                        if (uploadResult.success) {
                            console.log('✅ Uploaded to R2:', uploadResult.url);
                        } else {
                            console.error('R2 upload failed:', uploadResult.error);
                        }
                    } else {
                        console.log('R2 not configured, skipping cloud upload');
                    }
                } catch (err) {
                    console.error('Background R2 upload error:', err);
                }
            }, 100);
        } else {
            console.error('Processing failed:', result.error);
            alert('Error: ' + result.error);
            resetUI();
        }
    } catch (error) {
        console.error('Processing error:', error);
        alert('Failed to process image. Please try again.');
        resetUI();
    }
}

// Batch Functions
function addToBatch(image) {
    batchImages.push(image);
    
    const item = document.createElement('div');
    item.className = 'batch-item';
    item.dataset.index = batchImages.length - 1;
    item.innerHTML = `
        <img src="${image.data}" alt="${image.name}">
        <button class="remove-btn">&times;</button>
    `;
    
    item.querySelector('.remove-btn').addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        batchImages.splice(index, 1);
        item.remove();
        if (batchImages.length === 0) {
            resetUI();
        }
    });
    
    batchGrid.appendChild(item);
}

function showBatchUI() {
    uploadArea.style.display = 'none';
    batchContainer.style.display = 'block';
    processBatchBtn.style.display = 'inline-block';
    downloadAllBtn.style.display = 'none';
}

// Process Batch
processBatchBtn.addEventListener('click', async () => {
    processBatchBtn.disabled = true;
    processBatchBtn.textContent = 'Processing...';
    processedImages = [];
    
    const items = batchGrid.querySelectorAll('.batch-item');
    
    for (let i = 0; i < batchImages.length; i++) {
        const item = items[i];
        
        // Show overlay
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = '<div class="spinner"></div><span>Processing...</span>';
        item.appendChild(overlay);
        
        try {
            // Pass file path instead of base64 data
            const result = await window.electronAPI.removeBackground(batchImages[i].path);
            
            overlay.remove();
            
            if (result.success) {
                processedImages.push({ data: result.data, name: batchImages[i].name });
                item.querySelector('img').src = result.data;
                
                const status = document.createElement('div');
                status.className = 'status success';
                status.textContent = '✓';
                item.appendChild(status);
            } else {
                processedImages.push(null);
                
                const status = document.createElement('div');
                status.className = 'status error';
                status.textContent = '✗';
                item.appendChild(status);
            }
        } catch (error) {
            overlay.remove();
            processedImages.push(null);
            
            const status = document.createElement('div');
            status.className = 'status error';
            status.textContent = '✗';
            item.appendChild(status);
        }
    }
    
    processBatchBtn.style.display = 'none';
    downloadAllBtn.style.display = 'inline-block';
});

// Download Single
downloadBtn.addEventListener('click', async () => {
    const defaultName = 'background-removed.png';
    await window.electronAPI.saveImage(resultImage.src, defaultName);
});

// Download All
downloadAllBtn.addEventListener('click', async () => {
    for (let i = 0; i < processedImages.length; i++) {
        if (processedImages[i]) {
            const name = processedImages[i].name.replace(/\.[^/.]+$/, '') + '-no-bg.png';
            await window.electronAPI.saveImage(processedImages[i].data, name);
        }
    }
});

// New Image/Batch
newImageBtn.addEventListener('click', resetUI);
newBatchBtn.addEventListener('click', resetUI);

function resetUI() {
    uploadArea.style.display = 'block';
    processing.style.display = 'none';
    resultsContainer.style.display = 'none';
    batchContainer.style.display = 'none';
    batchGrid.innerHTML = '';
    batchImages = [];
    processedImages = [];
    processBatchBtn.disabled = false;
    processBatchBtn.textContent = 'Process All';
    processBatchBtn.style.display = 'inline-block';
    downloadAllBtn.style.display = 'none';
}

// Progress Updates - circle animation only, no text updates
window.electronAPI.onProgress((data) => {
    // Animation handles visual feedback, no text needed
    console.log('Progress:', data.key);
});

// Settings Modal Handlers
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const saveR2ConfigBtn = document.getElementById('save-r2-config');
const r2Status = document.getElementById('r2-status');

// Open settings modal
settingsBtn.addEventListener('click', async () => {
    settingsModal.style.display = 'flex';
    
    // Load existing R2 config
    const config = await window.electronAPI.r2.getConfig();
    if (config.configured) {
        document.getElementById('r2-endpoint').value = config.endpoint;
        document.getElementById('r2-bucket').value = config.bucketName;
        document.getElementById('r2-public-url').value = config.publicUrl;
        showR2Status('✅ R2 is configured', 'success');
    }
});

// Close settings modal
closeSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

// Close modal on background click
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
    }
});

// Save R2 configuration
saveR2ConfigBtn.addEventListener('click', async () => {
    const endpoint = document.getElementById('r2-endpoint').value.trim();
    const accessKey = document.getElementById('r2-access-key').value.trim();
    const secretKey = document.getElementById('r2-secret-key').value.trim();
    const bucketName = document.getElementById('r2-bucket').value.trim();
    const publicUrl = document.getElementById('r2-public-url').value.trim();
    
    if (!endpoint || !accessKey || !secretKey || !bucketName) {
        showR2Status('❌ Please fill in all required fields', 'error');
        return;
    }
    
    saveR2ConfigBtn.disabled = true;
    saveR2ConfigBtn.textContent = 'Saving...';
    
    const result = await window.electronAPI.r2.saveConfig({
        endpoint,
        accessKey,
        secretKey,
        bucketName,
        publicUrl
    });
    
    if (result.success) {
        showR2Status('✅ R2 configuration saved successfully!', 'success');
        // Clear sensitive fields
        document.getElementById('r2-access-key').value = '';
        document.getElementById('r2-secret-key').value = '';
    } else {
        showR2Status('❌ Failed to save: ' + result.error, 'error');
    }
    
    saveR2ConfigBtn.disabled = false;
    saveR2ConfigBtn.textContent = 'Save R2 Configuration';
});

function showR2Status(message, type) {
    r2Status.textContent = message;
    r2Status.style.display = 'block';
    r2Status.style.background = type === 'success' ? 'rgba(40, 167, 69, 0.2)' : 'rgba(220, 53, 69, 0.2)';
    r2Status.style.color = type === 'success' ? '#28a745' : '#dc3545';
    r2Status.style.border = `1px solid ${type === 'success' ? '#28a745' : '#dc3545'}`;
}

// Auto-update handlers
window.electronAPI.onUpdateAvailable((info) => {
    console.log('🔔 Update available:', info.version);
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--bg-secondary); border: 2px solid var(--primary); border-radius: 8px; padding: 15px 20px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
    notification.innerHTML = `
        <div style="color: var(--text-primary); font-weight: 500; margin-bottom: 8px;">🎉 Update Available: v${info.version}</div>
        <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 10px;">Downloading in background...</div>
        <div id="update-progress" style="height: 4px; background: var(--border); border-radius: 2px; overflow: hidden;">
            <div id="update-progress-bar" style="height: 100%; background: var(--primary); width: 0%; transition: width 0.3s;"></div>
        </div>
    `;
    document.body.appendChild(notification);
});

window.electronAPI.onUpdateDownloadProgress((progress) => {
    const progressBar = document.getElementById('update-progress-bar');
    if (progressBar) {
        progressBar.style.width = progress.percent + '%';
    }
});

window.electronAPI.onUpdateDownloaded((info) => {
    console.log('✅ Update downloaded:', info.version);
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--bg-secondary); border: 2px solid var(--success); border-radius: 8px; padding: 15px 20px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
    notification.innerHTML = `
        <div style="color: var(--text-primary); font-weight: 500; margin-bottom: 8px;">✅ Update Ready: v${info.version}</div>
        <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 10px;">Restart to install the update</div>
        <button id="install-update-btn" style="width: 100%; padding: 8px; background: var(--success); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">Restart & Install</button>
    `;
    document.body.appendChild(notification);
    
    document.getElementById('install-update-btn').addEventListener('click', () => {
        window.electronAPI.installUpdate();
    });
});
