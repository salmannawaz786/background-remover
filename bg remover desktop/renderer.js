// Cloudflare R2 Storage upload - runs in background (credentials handled securely in main.js)
async function uploadToR2Storage(imageData, filename) {
    console.log('🔄 Starting R2 upload...');
    
    try {
        // Check online
        if (!navigator.onLine) {
            console.log('⚠️ Offline - skipping R2 upload');
            return null;
        }
        
        // Get user info for folder organization
        let userUid = 'anonymous';
        const authState = await window.electronAPI.auth.getState();
        if (authState.isAuthenticated && authState.user) {
            userUid = authState.user.uid;
        }
        
        // Convert to blob
        const response = await fetch(imageData);
        const blob = await response.blob();
        console.log('✓ Blob size:', (blob.size / 1024).toFixed(2), 'KB');
        
        // Generate unique filename
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 10);
        const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const r2Key = `processed/${userUid}/${timestamp}_${uniqueId}_${safeName}`;
        
        // Upload via main process (handles R2 credentials securely)
        const result = await window.electronAPI.uploadToR2(blob, r2Key);
        
        if (result.success) {
            console.log('✅ R2 Upload SUCCESS:', result.url);
            return result.url;
        } else {
            console.error('❌ R2 Upload failed:', result.error);
            return null;
        }
        
    } catch (error) {
        console.error('❌ R2 upload error:', error.message);
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
const hdModeToggle = document.getElementById('hd-mode-toggle');

let currentMode = 'single';
let batchImages = [];
let processedImages = [];

// Speed / HD Mode Toggle
const speedLabelEl = document.querySelector('.speed-label');
const hdLabelEl = document.querySelector('.hd-label');

function updateToggleLabels() {
    if (hdModeToggle.checked) {
        speedLabelEl.style.opacity = '0.5';
        speedLabelEl.style.fontWeight = '400';
        hdLabelEl.style.opacity = '1';
        hdLabelEl.style.fontWeight = '700';
    } else {
        speedLabelEl.style.opacity = '1';
        speedLabelEl.style.fontWeight = '700';
        hdLabelEl.style.opacity = '0.5';
        hdLabelEl.style.fontWeight = '400';
    }
}

hdModeToggle.addEventListener('change', updateToggleLabels);
updateToggleLabels();

// Device Info Display
async function showDeviceInfo() {
    try {
        const info = await window.electronAPI.getDeviceInfo();
        const deviceIcon = document.getElementById('device-icon');
        const deviceName = document.getElementById('device-name');
        
        if (info.isAppleSilicon) {
            deviceIcon.textContent = '🍎';
            deviceName.textContent = info.gpuName;
        } else if (info.hasNvidiaGpu) {
            deviceIcon.textContent = '🟢';
            deviceName.textContent = info.gpuName;
        } else {
            deviceIcon.textContent = '💻';
            deviceName.textContent = `CPU (${info.cpuCores} cores)`;
        }
    } catch (e) {
        console.error('Failed to get device info:', e);
    }
}
showDeviceInfo();

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
    
    // Get current HD mode setting
    const hdMode = hdModeToggle.checked;
    console.log(`Processing in ${hdMode ? 'HD' : 'Speed'} mode:`, image.name);
    
    try {
        const result = await window.electronAPI.removeBackground(image.path, hdMode);
        
        console.log('Result received:', result.success ? 'Success' : 'Failed');
        
        if (result.success) {
            // Fix image display: wait for load before showing container
            resultImage.onload = () => {
                processing.style.display = 'none';
                resultsContainer.style.display = 'block';
                console.log('Result image loaded and visible');
            };
            resultImage.src = result.data;
            
            // Fallback: show after 1s if onload doesn't fire (large images)
            setTimeout(() => {
                processing.style.display = 'none';
                resultsContainer.style.display = 'block';
            }, 1000);
            
            // Upload to cloud storage in background (R2 only - don't await, don't block UI)
            setTimeout(() => {
                uploadToR2Storage(result.data, image.name).catch(err => {
                    console.error('R2 upload error:', err);
                });
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
    
    const hdMode = hdModeToggle.checked;
    
    for (let i = 0; i < batchImages.length; i++) {
        const item = items[i];
        
        // Show overlay
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = '<div class="spinner"></div><span>Processing...</span>';
        item.appendChild(overlay);
        
        try {
            const result = await window.electronAPI.removeBackground(batchImages[i].path, hdMode);
            
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
