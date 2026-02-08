/**
 * SalluLabs Watermark Remover - Desktop App v2
 * Renderer Process JavaScript – Optimized with batch processing
 */

class WatermarkRemoverDesktop {
    constructor() {
        // Canvas elements
        this.imageCanvas = document.getElementById('imageCanvas');
        this.maskCanvas = document.getElementById('maskCanvas');
        this.canvasContainer = document.getElementById('canvasContainer');
        this.imageCtx = this.imageCanvas?.getContext('2d');
        this.maskCtx = this.maskCanvas?.getContext('2d');

        // State
        this.isDrawing = false;
        this.currentImage = null;
        this.maskPaths = [];
        this.currentPath = [];
        this.processedImageUrl = null;
        this.brushColor = '#00FFFF';
        this._lastSparkleTime = 0;
        this.gpuInfo = null;
        this.activeMode = 'single'; // 'single' | 'batch'
        this._modelReady = false;
        this._splashMinDone = false;
        this._splashLottie = null;
        this._processingLottie = null;
        this._tipInterval = null;

        // Batch state
        this.batchItems = []; // [{name, data, path, maskData}]
        this.batchResults = []; // [{name, data, success}]

        // Tips pool (10+ tips, show 2 random each launch)
        this.tips = [
            { title: 'The Shadow Rule', text: 'Brush over the object AND its shadow for a more realistic removal!' },
            { title: 'The Segment Trick', text: 'Removing a long wire? Do it in small sections for the cleanest result.' },
            { title: 'One at a Time', text: 'Removing multiple things? Doing them one by one helps the AI stay sharp.' },
            { title: 'Zoom for Detail', text: 'Pinch to zoom! A smaller brush is the secret to perfect edges.' },
            { title: 'Try Again', text: 'Not perfect? A second pass over the same spot often fixes small glitches.' },
            { title: 'Less is More', text: 'Only brush the exact area you want removed. The tighter the mask, the better the result.' },
            { title: 'Background Matters', text: 'AI works best when there\'s enough surrounding context. Avoid masking right at the edge of an image.' },
            { title: 'Texture Match', text: 'For patterned surfaces (brick, fabric), a slightly larger brush helps the AI match the texture seamlessly.' },
            { title: 'Batch Power', text: 'Switch to Batch Mode to process up to 50 images at once - paint masks on each individually!' },
            { title: 'Undo is Your Friend', text: 'Made a mistake? Hit Undo (Ctrl+Z) to step back. You can undo as many strokes as you want.' },
            { title: 'Save Quality', text: 'Results are saved at 97% quality by default - virtually lossless, so your photos stay crisp.' },
            { title: 'Brush Size Tip', text: 'Use a large brush for big areas and switch to a small brush for fine details near edges.' }
        ];

        // Batch editor state
        this._beIndex = -1;
        this._bePaths = [];
        this._beCurrentPath = [];
        this._beDrawing = false;

        // Initialize
        this.init();
    }

    async init() {
        console.log('Initializing SalluLabs Watermark Remover Desktop v2...');
        
        // Check authentication
        try {
            const authState = await window.electronAPI.auth.getState();
            if (!authState.isAuthenticated) {
                window.location.href = '../auth.html';
                return;
            }
            // Display user info
            const userEmailEl = document.getElementById('user-email');
            if (userEmailEl && authState.user) {
                userEmailEl.textContent = authState.user.email;
                userEmailEl.style.display = 'inline';
            }
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.style.display = 'inline-block';
                logoutBtn.addEventListener('click', async () => {
                    await window.electronAPI.auth.logout();
                    localStorage.removeItem('user');
                    localStorage.removeItem('token');
                    window.location.href = '../auth.html';
                });
            }
        } catch (e) {
            console.warn('Auth check failed, continuing without auth:', e);
        }
        
        this.showSplash();
        await this.loadAppInfo();
        await this.detectGPU();
        await this.checkPythonSetup();
        this.setupEventListeners();
        this.setupCanvasEvents();
        this.setupMenuListeners();
        this.setupBatchListeners();
        this.setupModeToggle();
        this.setupBatchEditor();
        this.setupModelReadyListener();
        this.loadTheme();
        await this.updateSystemInfo();
        console.log('Initialization complete!');
    }

    // ─────────────────────────────────────────────
    // Splash Screen
    // ─────────────────────────────────────────────
    showSplash() {
        const splash = document.getElementById('splashScreen');
        if (!splash) return;

        // Shuffle and pick 1-2 random tips to show during splash
        const shuffled = [...this.tips].sort(() => Math.random() - 0.5);
        const count = Math.random() < 0.4 ? 1 : 2; // 40% chance of just 1 tip
        const picked = shuffled.slice(0, count);
        let tipIndex = 0;

        const tipContent = document.getElementById('splashTipContent');
        const updateTip = () => {
            const t = picked[tipIndex % picked.length];
            tipContent.innerHTML = `<div class="splash-tip-title">${t.title}</div><div class="splash-tip-text">${t.text}</div>`;
            tipIndex++;
        };
        updateTip();

        // Rotate tips every 4s (comfortable reading pace)
        if (picked.length > 1) {
            this._tipInterval = setInterval(updateTip, 4000);
        }

        // Load loadercat lottie animation
        try {
            this._splashLottie = lottie.loadAnimation({
                container: document.getElementById('splashLottie'),
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: 'loadercat.json'
            });
        } catch (e) {
            console.warn('Splash lottie failed:', e);
        }

        // Minimum 5 seconds display
        setTimeout(() => {
            this._splashMinDone = true;
            this._tryHideSplash();
        }, 5000);
    }

    setupModelReadyListener() {
        window.electronAPI.onModelReady((status) => {
            console.log('Model ready:', status);
            this._modelReady = true;
            this._tryHideSplash();
        });
    }

    _tryHideSplash() {
        if (!this._modelReady || !this._splashMinDone) return;
        const splash = document.getElementById('splashScreen');
        if (!splash || splash.classList.contains('hiding')) return;

        if (this._tipInterval) {
            clearInterval(this._tipInterval);
            this._tipInterval = null;
        }

        splash.classList.add('hiding');
        setTimeout(() => {
            splash.classList.add('hidden');
            if (this._splashLottie) {
                this._splashLottie.destroy();
                this._splashLottie = null;
            }
        }, 500);
    }

    async loadAppInfo() {
        try {
            const info = await window.electronAPI.getAppInfo();
            document.getElementById('version-tag').textContent = `v${info.version}`;
            document.title = info.name;
        } catch (e) {
            console.error('Failed to load app info:', e);
        }
    }

    async detectGPU() {
        try {
            this.gpuInfo = await window.electronAPI.getGPUInfo();
            const gpuStatus = document.getElementById('gpu-status');
            const gpuFooter = document.getElementById('gpuFooter');

            if (this.gpuInfo.hasGPU) {
                gpuStatus.classList.add('gpu-available');
                const shortName = this.gpuInfo.gpuName.substring(0, 25);
                gpuStatus.innerHTML = `<span class="gpu-icon">🚀</span><span class="gpu-text">${shortName}</span>`;
                if (gpuFooter) gpuFooter.textContent = `GPU: ${shortName}`;
            } else {
                gpuStatus.innerHTML = `<span class="gpu-icon">💻</span><span class="gpu-text">CPU Mode</span>`;
                if (gpuFooter) gpuFooter.textContent = 'CPU Mode';
            }
            console.log('GPU Info:', this.gpuInfo);
        } catch (e) {
            console.error('Failed to detect GPU:', e);
        }
    }

    async checkPythonSetup() {
        try {
            const pythonInfo = await window.electronAPI.checkPython();
            if (!pythonInfo.available) {
                this.showSetupModal(`
                    <p>Python 3 is required but not found on your system.</p>
                    <ul>
                        <li><strong>Windows:</strong> Download from <code>python.org</code></li>
                        <li><strong>macOS:</strong> Run <code>brew install python3</code></li>
                        <li><strong>Linux:</strong> Run <code>sudo apt install python3</code></li>
                    </ul>
                    <p>After installing Python, also install required packages:</p>
                    <code>pip install torch torchvision opencv-python pillow numpy</code>
                `);
            }
        } catch (e) {
            console.error('Failed to check Python:', e);
        }
    }

    showSetupModal(content) {
        const modal = document.getElementById('setupModal');
        const modalContent = document.getElementById('setupModalContent');
        modalContent.innerHTML = content;
        modal.classList.add('show');
    }

    hideSetupModal() {
        document.getElementById('setupModal').classList.remove('show');
    }

    async updateSystemInfo() {
        try {
            const s = await window.electronAPI.getSystemInfo();
            const os = s.platform === 'darwin' ? 'macOS' : s.platform === 'win32' ? 'Windows' : 'Linux';
            document.getElementById('systemInfo').textContent = `${os} | ${s.cpus} CPUs | ${s.totalMemory}GB RAM`;
        } catch (e) {
            console.error('Failed to get system info:', e);
        }
    }

    // ─────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────
    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const selectFileBtn = document.getElementById('selectFileBtn');

        uploadArea.addEventListener('click', () => this.openFileDialog());
        selectFileBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openFileDialog(); });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); uploadArea.classList.remove('dragover'); });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) this.loadImageFromFile(e.dataTransfer.files[0]);
        });

        // Brush size
        document.getElementById('brushSize').addEventListener('input', (e) => this.updateBrushSizeDisplay(e.target.value));

        // Buttons
        document.getElementById('clearMask').addEventListener('click', () => this.clearMask());
        document.getElementById('undoLast').addEventListener('click', () => this.undoLast());
        document.getElementById('resetImage').addEventListener('click', () => this.resetImage());
        document.getElementById('processImage').addEventListener('click', () => this.processImage());
        document.getElementById('downloadResult').addEventListener('click', () => this.downloadResult());
        document.getElementById('processAnother').addEventListener('click', () => this.processAnother());
        document.getElementById('cancelProcessing').addEventListener('click', () => this.cancelProcessing());
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        document.getElementById('setupModalClose').addEventListener('click', () => this.hideSetupModal());

        // Resize
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (this.currentImage) this.setupImageCanvas(this.currentImage); }, 200);
        });
    }

    setupCanvasEvents() {
        if (!this.imageCanvas) return;

        // Mouse events
        this.imageCanvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.imageCanvas.addEventListener('mousemove', (e) => {
            this.draw(e);
            this._updateCursorSparkle(e);
        });
        this.imageCanvas.addEventListener('mouseup', () => this.stopDrawing());
        this.imageCanvas.addEventListener('mouseout', () => { this.stopDrawing(); this._removeCursorOverlay(); });
        this.imageCanvas.addEventListener('mouseenter', (e) => this._updateCursorSparkle(e));

        // Touch events
        this.imageCanvas.addEventListener('touchstart', (e) => this.startDrawing(e), { passive: false });
        this.imageCanvas.addEventListener('touchmove', (e) => this.draw(e), { passive: false });
        this.imageCanvas.addEventListener('touchend', () => this.stopDrawing());
        this.imageCanvas.addEventListener('touchcancel', () => this.stopDrawing());

        // Hide default cursor, semi-transparent mask overlay
        this.imageCanvas.style.cursor = 'none';
        this.maskCanvas.style.cursor = 'none';
        this.maskCanvas.style.opacity = '0.4';
    }

    setupMenuListeners() {
        window.electronAPI.onMenuOpenImage(() => this.openFileDialog());
        window.electronAPI.onMenuSaveResult(() => this.downloadResult());
        window.electronAPI.onMenuUndo(() => this.undoLast());
        window.electronAPI.onMenuClearMask(() => this.clearMask());
        window.electronAPI.onMenuReset(() => this.resetImage());

        window.electronAPI.onProcessingProgress((progress) => this.updateProgress(progress));
        window.electronAPI.onProcessingStatus((status) => {
            const el = document.getElementById('loadingStatus');
            if (el) el.textContent = status;
        });
    }

    // ─────────────────────────────────────────────
    // Mode Toggle
    // ─────────────────────────────────────────────
    setupModeToggle() {
        document.getElementById('modeSingle').addEventListener('click', () => this.setMode('single'));
        document.getElementById('modeBatch').addEventListener('click', () => this.setMode('batch'));
    }

    setMode(mode) {
        this.activeMode = mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(mode === 'single' ? 'modeSingle' : 'modeBatch').classList.add('active');

        const upload = document.getElementById('uploadSection');
        const batch  = document.getElementById('batchSection');

        if (mode === 'single') {
            upload.style.display = 'block';
            batch.style.display = 'none';
        } else {
            upload.style.display = 'none';
            batch.style.display = 'block';
        }
        // Hide other sections
        document.getElementById('editorSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('batchResultsSection').style.display = 'none';
    }

    // ─────────────────────────────────────────────
    // Batch Processing
    // ─────────────────────────────────────────────
    setupBatchListeners() {
        document.getElementById('addBatchImages').addEventListener('click', () => this.addBatchImages());
        document.getElementById('processBatch').addEventListener('click', () => this.processBatch());
        document.getElementById('clearBatch').addEventListener('click', () => this.clearBatch());
        document.getElementById('batchProcessAnother').addEventListener('click', () => this.batchProcessAnother());

        // Batch IPC events
        window.electronAPI.onBatchIndex((idx) => {
            const items = document.querySelectorAll('.batch-item');
            items.forEach((el, i) => {
                el.classList.remove('processing');
                if (i === idx) {
                    el.classList.add('processing');
                    if (!el.querySelector('.batch-item-indicator')) {
                        const indicator = document.createElement('div');
                        indicator.className = 'batch-item-indicator';
                        indicator.innerHTML = `<svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"/><circle class="progress" cx="24" cy="24" r="20"/></svg>`;
                        el.appendChild(indicator);
                    }
                }
            });
        });

        window.electronAPI.onBatchItemDone((payload) => {
            const items = document.querySelectorAll('.batch-item');
            if (items[payload.index]) {
                items[payload.index].classList.remove('processing');
                items[payload.index].classList.add('done');
                const indicator = items[payload.index].querySelector('.batch-item-indicator');
                if (indicator) indicator.remove();
                if (payload.success) {
                    const check = document.createElement('div');
                    check.className = 'batch-item-check';
                    check.textContent = '✓';
                    items[payload.index].appendChild(check);
                }
            }
        });
    }

    async addBatchImages() {
        try {
            const result = await window.electronAPI.openBatchDialog();
            if (!result.success) return;

            const remaining = 50 - this.batchItems.length;
            const newItems = result.items.slice(0, remaining);
            this.batchItems.push(...newItems);
            this._renderBatchGrid();
            this.showSuccess(`Added ${newItems.length} image(s). Total: ${this.batchItems.length}`);
        } catch (e) {
            this.showError('Failed to add images: ' + e.message);
        }
    }

    _renderBatchGrid() {
        const grid = document.getElementById('batchGrid');
        grid.innerHTML = '';

        this.batchItems.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'batch-item';
            div.innerHTML = `
                <img src="${item.data}" alt="${item.name}">
                <div class="batch-item-name">${item.name}</div>
                <button class="batch-item-remove" data-index="${i}">&times;</button>
                ${item.maskData ? '<div class="batch-item-painted">masked</div>' : ''}
            `;
            // Click image to open paint editor
            div.addEventListener('click', (e) => {
                if (e.target.classList.contains('batch-item-remove')) return;
                this._openBatchEditor(i);
            });
            div.querySelector('.batch-item-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                this.batchItems.splice(i, 1);
                this._renderBatchGrid();
            });
            grid.appendChild(div);
        });

        document.getElementById('batchCount').textContent = `${this.batchItems.length} image${this.batchItems.length !== 1 ? 's' : ''}`;
        document.getElementById('processBatch').disabled = this.batchItems.length === 0;
    }

    async processBatch() {
        if (this.batchItems.length === 0) {
            this.showError('Add images to the batch first.');
            return;
        }

        // Check that every item has a mask painted
        const unpainted = this.batchItems.filter(it => !it.maskData);
        if (unpainted.length > 0) {
            this.showError(`${unpainted.length} image(s) have no mask. Click each image to paint the area to remove.`);
            return;
        }

        this.showLoading();

        try {
            const device = this.gpuInfo?.recommendation || 'auto';

            const items = this.batchItems.map(item => ({
                imageData: item.data,
                maskData: item.maskData,
                originalName: item.name
            }));

            const result = await window.electronAPI.processBatch({ items, device });

            this.hideLoading();

            if (result.success && result.results) {
                this.batchResults = result.results.map((r, i) => ({
                    name: this.batchItems[i]?.name || `image_${i}.png`,
                    data: r.data,
                    success: r.success
                }));
                this._showBatchResults();
                this.showSuccess(`Batch complete! ${result.results.filter(r => r.success).length}/${result.results.length} processed.`);
            } else {
                this.showError(result.error || 'Batch processing failed.');
            }
        } catch (e) {
            this.hideLoading();
            this.showError('Batch failed: ' + e.message);
        }
    }

    _showBatchResults() {
        // Hide other sections
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('editorSection').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('batchSection').style.display = 'none';
        document.getElementById('batchResultsSection').style.display = 'block';

        const grid = document.getElementById('batchResultsGrid');
        grid.innerHTML = '';

        this.batchResults.forEach((item, i) => {
            if (!item.success || !item.data) return;

            const card = document.createElement('div');
            card.className = 'batch-result-card';
            card.innerHTML = `
                <img src="${item.data}" alt="${item.name}">
                <div class="batch-result-card-overlay">
                    <button class="batch-result-download-btn" data-index="${i}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                        Download
                    </button>
                    <span class="batch-result-name">${item.name}</span>
                </div>
            `;
            card.querySelector('.batch-result-download-btn').addEventListener('click', () => {
                this._downloadBatchItem(i);
            });
            grid.appendChild(card);
        });
    }

    async _downloadBatchItem(index) {
        const item = this.batchResults[index];
        if (!item || !item.data) return;
        try {
            const name = item.name.replace(/\.[^.]+$/, '') + '_cleaned.png';
            const result = await window.electronAPI.saveBatchFile({ imageData: item.data, defaultName: name });
            if (result.success) this.showSuccess(`Saved: ${result.path}`);
        } catch (e) {
            this.showError('Save failed: ' + e.message);
        }
    }

    clearBatch() {
        this.batchItems = [];
        this._renderBatchGrid();
    }

    batchProcessAnother() {
        this.batchResults = [];
        document.getElementById('batchResultsSection').style.display = 'none';
        this.setMode('batch');
        this.clearBatch();
    }

    // ─────────────────────────────────────────────
    // Batch Editor Modal (paint mask per image)
    // ─────────────────────────────────────────────
    setupBatchEditor() {
        const imgC = document.getElementById('batchEditorImageCanvas');
        const mskC = document.getElementById('batchEditorMaskCanvas');

        // Drawing on the modal canvas
        imgC.addEventListener('mousedown', (e) => this._beStartDraw(e));
        imgC.addEventListener('mousemove', (e) => this._beDraw(e));
        imgC.addEventListener('mouseup', () => this._beStopDraw());
        imgC.addEventListener('mouseout', () => this._beStopDraw());
        imgC.addEventListener('touchstart', (e) => this._beStartDraw(e), { passive: false });
        imgC.addEventListener('touchmove', (e) => this._beDraw(e), { passive: false });
        imgC.addEventListener('touchend', () => this._beStopDraw());
        imgC.style.cursor = 'crosshair';

        document.getElementById('batchBrushSize').addEventListener('input', (e) => {
            document.getElementById('batchBrushValue').textContent = e.target.value + '%';
        });
        document.getElementById('batchEditorClear').addEventListener('click', () => {
            this._bePaths = [];
            const ctx = mskC.getContext('2d');
            ctx.clearRect(0, 0, mskC.width, mskC.height);
        });
        document.getElementById('batchEditorUndo').addEventListener('click', () => {
            if (this._bePaths.length > 0) { this._bePaths.pop(); this._beRedraw(); }
        });
        document.getElementById('batchEditorCancel').addEventListener('click', () => {
            document.getElementById('batchEditorModal').classList.remove('show');
        });
        document.getElementById('batchEditorSave').addEventListener('click', () => {
            this._beSaveMask();
        });
    }

    _openBatchEditor(index) {
        this._beIndex = index;
        this._bePaths = [];
        this._beCurrentPath = [];
        const item = this.batchItems[index];

        document.getElementById('batchEditorTitle').textContent = `Paint mask: ${item.name}`;

        const imgC = document.getElementById('batchEditorImageCanvas');
        const mskC = document.getElementById('batchEditorMaskCanvas');
        const wrap = document.getElementById('batchEditorCanvasWrap');

        const img = new Image();
        img.onload = () => {
            const wrapRect = wrap.getBoundingClientRect();
            const maxW = wrapRect.width - 20 || 800;
            const maxH = window.innerHeight * 0.55;
            const ar = img.naturalWidth / img.naturalHeight;
            let dw, dh;
            if (img.naturalWidth / maxW > img.naturalHeight / maxH) {
                dw = Math.min(img.naturalWidth, maxW); dh = dw / ar;
            } else {
                dh = Math.min(img.naturalHeight, maxH); dw = dh * ar;
            }

            imgC.width = img.naturalWidth;
            imgC.height = img.naturalHeight;
            mskC.width = img.naturalWidth;
            mskC.height = img.naturalHeight;
            imgC.style.width = dw + 'px';
            imgC.style.height = dh + 'px';
            mskC.style.width = dw + 'px';
            mskC.style.height = dh + 'px';

            const imgCtx = imgC.getContext('2d');
            imgCtx.clearRect(0, 0, imgC.width, imgC.height);
            imgCtx.drawImage(img, 0, 0);

            const mskCtx = mskC.getContext('2d');
            mskCtx.clearRect(0, 0, mskC.width, mskC.height);

            // If item already has a saved mask, redraw it
            if (item.maskData) {
                const mImg = new Image();
                mImg.onload = () => { mskCtx.drawImage(mImg, 0, 0); };
                mImg.src = item.maskData;
            }

            document.getElementById('batchEditorModal').classList.add('show');
        };
        img.src = item.data;
    }

    _beGetPos(e) {
        const c = document.getElementById('batchEditorImageCanvas');
        const rect = c.getBoundingClientRect();
        const sx = c.width / rect.width, sy = c.height / rect.height;
        let cx, cy;
        if (e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
    }

    _beGetBrush() {
        const c = document.getElementById('batchEditorImageCanvas');
        const pct = parseFloat(document.getElementById('batchBrushSize')?.value || 4);
        const diag = Math.hypot(c.width, c.height);
        return Math.max(4, Math.round(diag * (pct / 100)));
    }

    _beStartDraw(e) {
        e.preventDefault();
        this._beDrawing = true;
        const pos = this._beGetPos(e);
        this._beCurrentPath = [pos];
        this._beDraw(e);
    }

    _beDraw(e) {
        if (!this._beDrawing) return;
        e.preventDefault();
        const pos = this._beGetPos(e);
        this._beCurrentPath.push(pos);
        const bs = this._beGetBrush();
        const ctx = document.getElementById('batchEditorMaskCanvas').getContext('2d');
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = this.brushColor;
        ctx.fillStyle = this.brushColor;
        ctx.lineWidth = bs;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (this._beCurrentPath.length > 1) {
            const prev = this._beCurrentPath[this._beCurrentPath.length - 2];
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(pos.x, pos.y, bs / 2, 0, 2 * Math.PI); ctx.fill();
    }

    _beStopDraw() {
        if (this._beDrawing && this._beCurrentPath.length > 0) {
            this._bePaths.push([...this._beCurrentPath]);
            this._beCurrentPath = [];
        }
        this._beDrawing = false;
    }

    _beRedraw() {
        const mskC = document.getElementById('batchEditorMaskCanvas');
        const ctx = mskC.getContext('2d');
        ctx.clearRect(0, 0, mskC.width, mskC.height);
        const bs = this._beGetBrush();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = this.brushColor;
        ctx.fillStyle = this.brushColor;
        ctx.lineWidth = bs;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this._bePaths.forEach(path => {
            if (path.length > 1) {
                ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
                ctx.stroke();
            }
            path.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, bs / 2, 0, 2 * Math.PI); ctx.fill(); });
        });
    }

    _beSaveMask() {
        const mskC = document.getElementById('batchEditorMaskCanvas');
        const maskDataUrl = mskC.toDataURL('image/png');
        if (this._beIndex >= 0 && this._beIndex < this.batchItems.length) {
            this.batchItems[this._beIndex].maskData = maskDataUrl;
        }
        document.getElementById('batchEditorModal').classList.remove('show');
        this._renderBatchGrid();
        this.showSuccess('Mask saved for ' + this.batchItems[this._beIndex]?.name);
    }

    // ─────────────────────────────────────────────
    // Theme
    // ─────────────────────────────────────────────
    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    }

    // ─────────────────────────────────────────────
    // File operations
    // ─────────────────────────────────────────────
    async openFileDialog() {
        try {
            const result = await window.electronAPI.openFileDialog();
            if (result.success) this.loadImageFromDataUrl(result.data, result.name);
        } catch (e) {
            this.showError('Failed to open file: ' + e.message);
        }
    }

    loadImageFromFile(file) {
        if (!file.type.startsWith('image/')) { this.showError('Please select a valid image file.'); return; }
        const reader = new FileReader();
        reader.onload = (e) => this.loadImageFromDataUrl(e.target.result, file.name);
        reader.onerror = () => this.showError('Failed to read file.');
        reader.readAsDataURL(file);
    }

    loadImageFromDataUrl(dataUrl, fileName) {
        const img = new Image();
        img.onload = () => {
            this.currentImage = img;
            this.setupImageCanvas(img);
            this.showEditor();
            this.showSuccess(`Loaded: ${fileName}`);
        };
        img.onerror = () => this.showError('Failed to load image.');
        img.src = dataUrl;
    }

    // ─────────────────────────────────────────────
    // Canvas setup
    // ─────────────────────────────────────────────
    setupImageCanvas(img) {
        if (!this.imageCanvas || !this.maskCanvas || !this.canvasContainer) return;

        this.imageCtx = this.imageCanvas.getContext('2d');
        this.maskCtx = this.maskCanvas.getContext('2d');

        const containerRect = this.canvasContainer.getBoundingClientRect();
        const maxWidth = containerRect.width - 40;
        const maxHeight = window.innerHeight * 0.6;
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        let displayWidth, displayHeight;

        if (img.naturalWidth / maxWidth > img.naturalHeight / maxHeight) {
            displayWidth = Math.min(img.naturalWidth, maxWidth);
            displayHeight = displayWidth / aspectRatio;
        } else {
            displayHeight = Math.min(img.naturalHeight, maxHeight);
            displayWidth = displayHeight * aspectRatio;
        }

        this.imageCanvas.width = img.naturalWidth;
        this.imageCanvas.height = img.naturalHeight;
        this.maskCanvas.width = img.naturalWidth;
        this.maskCanvas.height = img.naturalHeight;

        this.imageCanvas.style.width = displayWidth + 'px';
        this.imageCanvas.style.height = displayHeight + 'px';
        this.maskCanvas.style.width = displayWidth + 'px';
        this.maskCanvas.style.height = displayHeight + 'px';

        this.maskCanvas.style.position = 'absolute';
        this.maskCanvas.style.top = '50%';
        this.maskCanvas.style.left = '50%';
        this.maskCanvas.style.transform = 'translate(-50%, -50%)';

        this.imageCtx.clearRect(0, 0, this.imageCanvas.width, this.imageCanvas.height);
        this.imageCtx.drawImage(img, 0, 0, this.imageCanvas.width, this.imageCanvas.height);
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.maskPaths = [];
        this.canvasContainer.classList.add('has-image');
        this.updateBrushSizeDisplay();
    }

    // ─────────────────────────────────────────────
    // Brush
    // ─────────────────────────────────────────────
    getBrushSizePercent() {
        return parseFloat(document.getElementById('brushSize')?.value || 4);
    }

    getBrushSizePx() {
        if (!this.imageCanvas) return 20;
        const percent = this.getBrushSizePercent();
        const diagonal = Math.hypot(this.imageCanvas.width, this.imageCanvas.height);
        return Math.max(4, Math.round(diagonal * (percent / 100)));
    }

    updateBrushSizeDisplay(valueOverride) {
        const sizeValue = document.getElementById('brushSizeValue');
        if (!sizeValue) return;
        const percent = valueOverride ? parseFloat(valueOverride) : this.getBrushSizePercent();
        const px = this.currentImage ? this.getBrushSizePx() : null;
        sizeValue.textContent = px ? `${percent}% (${px}px)` : `${percent}%`;
    }

    // ─────────────────────────────────────────────
    // Drawing
    // ─────────────────────────────────────────────
    getMousePos(e) {
        const rect = this.imageCanvas.getBoundingClientRect();
        const scaleX = this.imageCanvas.width / rect.width;
        const scaleY = this.imageCanvas.height / rect.height;
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
        else { clientX = e.clientX; clientY = e.clientY; }
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    startDrawing(e) {
        e.preventDefault();
        this.isDrawing = true;
        const pos = this.getMousePos(e);
        this.currentPath = [pos];
        this.draw(e);
    }

    draw(e) {
        if (!this.isDrawing) return;
        e.preventDefault();
        const pos = this.getMousePos(e);
        this.currentPath.push(pos);
        const brushSize = this.getBrushSizePx();

        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.strokeStyle = this.brushColor;
        this.maskCtx.fillStyle = this.brushColor;
        this.maskCtx.lineWidth = brushSize;
        this.maskCtx.lineCap = 'round';
        this.maskCtx.lineJoin = 'round';

        if (this.currentPath.length > 1) {
            const prev = this.currentPath[this.currentPath.length - 2];
            this.maskCtx.beginPath();
            this.maskCtx.moveTo(prev.x, prev.y);
            this.maskCtx.lineTo(pos.x, pos.y);
            this.maskCtx.stroke();
        }
        this.maskCtx.beginPath();
        this.maskCtx.arc(pos.x, pos.y, brushSize / 2, 0, 2 * Math.PI);
        this.maskCtx.fill();

        this._emitSparkles(e);
    }

    stopDrawing() {
        if (this.isDrawing && this.currentPath.length > 0) {
            this.maskPaths.push([...this.currentPath]);
            this.currentPath = [];
        }
        this.isDrawing = false;
    }

    clearMask() {
        if (this.maskCtx) this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.maskPaths = [];
    }

    undoLast() {
        if (this.maskPaths.length > 0) { this.maskPaths.pop(); this.redrawMask(); }
    }

    redrawMask() {
        if (!this.maskCtx) return;
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        const brushSize = this.getBrushSizePx();
        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.strokeStyle = this.brushColor;
        this.maskCtx.fillStyle = this.brushColor;
        this.maskCtx.lineWidth = brushSize;
        this.maskCtx.lineCap = 'round';
        this.maskCtx.lineJoin = 'round';

        this.maskPaths.forEach(path => {
            if (path.length > 1) {
                this.maskCtx.beginPath();
                this.maskCtx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) this.maskCtx.lineTo(path[i].x, path[i].y);
                this.maskCtx.stroke();
            }
            path.forEach(pos => {
                this.maskCtx.beginPath();
                this.maskCtx.arc(pos.x, pos.y, brushSize / 2, 0, 2 * Math.PI);
                this.maskCtx.fill();
            });
        });
    }

    // ─────────────────────────────────────────────
    // Sparkle cursor effect (photoroom-style)
    // ─────────────────────────────────────────────
    _updateCursorSparkle(e) {
        const rect = this.imageCanvas.getBoundingClientRect();
        const x = e.clientX || 0;
        const y = e.clientY || 0;

        let overlay = document.getElementById('brushCursorOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'brushCursorOverlay';
            overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;';
            document.body.appendChild(overlay);
        }

        const percent = this.getBrushSizePercent();
        const diagonal = Math.hypot(rect.width, rect.height);
        const displaySize = Math.max(8, diagonal * (percent / 100));

        overlay.style.left = (x - displaySize / 2) + 'px';
        overlay.style.top = (y - displaySize / 2) + 'px';
        overlay.style.width = displaySize + 'px';
        overlay.style.height = displaySize + 'px';
        overlay.style.borderRadius = '50%';
        overlay.style.border = '2px solid rgba(0,255,255,0.7)';
        overlay.style.background = 'radial-gradient(circle, rgba(0,255,255,0.15) 0%, transparent 70%)';
        overlay.style.boxShadow = '0 0 8px rgba(0,255,255,0.3), inset 0 0 6px rgba(0,255,255,0.15)';
        overlay.style.display = 'block';
    }

    _removeCursorOverlay() {
        const overlay = document.getElementById('brushCursorOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    _emitSparkles(e) {
        const now = performance.now();
        if (now - this._lastSparkleTime < 60) return;
        this._lastSparkleTime = now;

        const x = e.clientX || 0;
        const y = e.clientY || 0;
        for (let i = 0; i < 2; i++) {
            const spark = document.createElement('div');
            spark.className = 'brush-sparkle';
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 18 + 6;
            const sx = x + Math.cos(angle) * dist;
            const sy = y + Math.sin(angle) * dist;
            const size = Math.random() * 6 + 3;
            spark.style.cssText = `position:fixed;pointer-events:none;z-index:99998;left:${sx}px;top:${sy}px;width:${size}px;height:${size}px;`;
            spark.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"><path d="M12 2l2.09 6.26L20.18 10l-6.09 1.74L12 18l-2.09-6.26L3.82 10l6.09-1.74L12 2z" fill="rgba(0,255,255,0.7)"/></svg>`;
            document.body.appendChild(spark);
            spark.animate([
                { opacity: 1, transform: 'scale(1) translate(0,0)' },
                { opacity: 0, transform: `scale(0.2) translate(${(Math.random()-0.5)*20}px, ${(Math.random()-0.5)*20}px)` }
            ], { duration: 500 + Math.random() * 300, easing: 'ease-out' }).onfinish = () => spark.remove();
        }
    }

    // ─────────────────────────────────────────────
    // Sections
    // ─────────────────────────────────────────────
    showEditor() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('editorSection').style.display = 'block';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('batchSection').style.display = 'none';
        document.getElementById('batchResultsSection').style.display = 'none';
    }

    resetImage() {
        this.currentImage = null;
        this.processedImageUrl = null;
        this.clearMask();
        this.canvasContainer?.classList.remove('has-image');
        this.hideMessages();
        // Return to whichever mode is active
        this.setMode(this.activeMode);
    }

    // ─────────────────────────────────────────────
    // Single image processing
    // ─────────────────────────────────────────────
    async processImage() {
        if (!this.currentImage || this.maskPaths.length === 0) {
            this.showError('Please upload an image and mark areas to remove.');
            return;
        }
        this.showLoading();
        try {
            const imageData = this.imageCanvas.toDataURL('image/png');
            const maskData = this.maskCanvas.toDataURL('image/png');
            const device = this.gpuInfo?.recommendation || 'auto';

            const result = await window.electronAPI.processImage({ imageData, maskData, device });

            if (result.success) {
                this.showResults(imageData, result.data);
                this.showSuccess('Image processed successfully!');
            } else {
                this.showError(result.error || 'Processing failed.');
                this.showEditor();
            }
        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Processing failed: ' + error.message);
            this.showEditor();
        } finally {
            this.hideLoading();
        }
    }

    async cancelProcessing() {
        try {
            await window.electronAPI.cancelProcessing();
            this.hideLoading();
            this.showEditor();
            this.showSuccess('Processing cancelled.');
        } catch (e) { console.error('Failed to cancel:', e); }
    }

    updateProgress(progress) {
        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = progress + '%';
    }

    showResults(originalUrl, processedUrl) {
        document.getElementById('originalResult').src = originalUrl;
        document.getElementById('processedResult').src = processedUrl;
        document.getElementById('editorSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'block';
        document.getElementById('batchSection').style.display = 'none';
        this.processedImageUrl = processedUrl;
    }

    async downloadResult() {
        if (!this.processedImageUrl) { this.showError('No result to download.'); return; }
        try {
            const result = await window.electronAPI.saveFileDialog(this.processedImageUrl);
            if (result.success) this.showSuccess(`Saved to: ${result.path}`);
        } catch (e) { this.showError('Failed to save: ' + e.message); }
    }

    processAnother() { this.resetImage(); }

    // ─────────────────────────────────────────────
    // Loading / Messages
    // ─────────────────────────────────────────────
    showLoading() {
        document.getElementById('editorSection').style.display = 'none';
        document.getElementById('batchSection').style.display = 'none';
        document.getElementById('loadingSection').style.display = 'flex';
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('loadingStatus').textContent = 'Starting AI engine...';

        // Start quby processing lottie
        try {
            const container = document.getElementById('processingLottie');
            if (container && typeof lottie !== 'undefined') {
                container.innerHTML = '';
                this._processingLottie = lottie.loadAnimation({
                    container: container,
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    path: 'hand.json'
                });
            }
        } catch (e) {
            console.warn('Processing lottie failed:', e);
        }
    }

    hideLoading() {
        document.getElementById('loadingSection').style.display = 'none';
        if (this._processingLottie) {
            this._processingLottie.destroy();
            this._processingLottie = null;
        }
    }

    showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => this.hideMessages(), 5000);
    }

    showSuccess(message) {
        const el = document.getElementById('successMessage');
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => this.hideMessages(), 3000);
    }

    hideMessages() {
        document.getElementById('errorMessage').style.display = 'none';
        document.getElementById('successMessage').style.display = 'none';
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.watermarkRemover = new WatermarkRemoverDesktop();
});
