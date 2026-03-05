/**
 * Client-Side Background Remover v2.2
 * ====================================
 * Smart routing: Person → RVM, Object → RMBG
 * Uses Cache API for fast model storage
 * Uses Web Workers for non-blocking inference
 * 
 * CRITICAL ROUTING LOGIC:
 * - Person detected + RVM ready → use RVM locally
 * - Person detected + RVM not ready → use SERVER
 * - Object detected + RMBG ready → use RMBG locally  
 * - Object detected + RMBG not ready → use SERVER + start RMBG download
 */

const ClientProcessor = (() => {
    // Model configs
    const MODELS = {
        rvm: {
            id: 'rvm-mobilenetv3',
            url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
            size: 15  // MB
        },
        rmbg: {
            id: 'rmbg-1.4-quantized', 
            url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
            size: 40  // MB
        }
    };

    const CACHE_NAME = 'bg-remover-models-v2';
    
    // State
    let _rvmSession = null;
    let _rmbgSession = null;
    let _rvmReady = false;
    let _rmbgReady = false;
    let _rvmDownloading = false;
    let _rmbgDownloading = false;
    let _faceDetector = null;
    let _faceDetectorSupported = false;
    let _deviceInfo = { capable: true, isMobile: false };
    let _initPromise = null;
    
    // Web Worker for non-blocking inference
    let _worker = null;
    let _workerReady = false;
    let _workerCallbacks = {};
    let _workerMessageId = 0;
    
    // ── Web Worker Setup ─────────────────────────────────────────────────────
    
    function initWorker() {
        if (_worker) return Promise.resolve();
        
        return new Promise((resolve, reject) => {
            try {
                _worker = new Worker('/static/onnx-worker.js');
                _worker.onmessage = (e) => {
                    const { id, error, ...data } = e.data;
                    const callback = _workerCallbacks[id];
                    if (callback) {
                        delete _workerCallbacks[id];
                        if (error) {
                            callback.reject(new Error(error));
                        } else {
                            callback.resolve(data);
                        }
                    }
                };
                _worker.onerror = (e) => {
                    console.error('[Worker] Error:', e.message);
                };
                _workerReady = true;
                resolve();
            } catch (e) {
                console.warn('[Worker] Failed to create worker, using main thread:', e.message);
                _workerReady = false;
                resolve(); // Don't reject, fallback to main thread
            }
        });
    }
    
    function postToWorker(type, data) {
        return new Promise((resolve, reject) => {
            const id = ++_workerMessageId;
            _workerCallbacks[id] = { resolve, reject };
            _worker.postMessage({ type, data, id });
        });
    }

    // ── Cache API helpers (faster than IndexedDB) ─────────────────────────

    async function getCachedModel(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = await cache.match(modelKey);
            if (response) {
                return await response.arrayBuffer();
            }
        } catch (e) {
            // Cache read error
        }
        return null;
    }

    async function cacheModel(modelKey, arrayBuffer) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = new Response(arrayBuffer, {
                headers: { 'Content-Type': 'application/octet-stream' }
            });
            await cache.put(modelKey, response);
            return true;
        } catch (e) {
            // Cache write error
            return false;
        }
    }

    async function isModelCached(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = await cache.match(modelKey);
            return !!response;
        } catch (e) {
            return false;
        }
    }

    // ── Face Detection (IMPROVED - stricter person detection) ─────────────

    async function initFaceDetector() {
        // Try browser's FaceDetector API first (Chrome 70+)
        if ('FaceDetector' in window) {
            try {
                const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
                _faceDetector = detector;
                _faceDetectorSupported = true;
                return true;
            } catch (e) {
                // Browser API not available
            }
        }
        _faceDetectorSupported = false;
        return false;
    }

    async function detectPerson(imageElement) {
        // PRIORITY 1: Use browser FaceDetector API if available (most accurate)
        if (_faceDetector && _faceDetectorSupported) {
            try {
                const faces = await _faceDetector.detect(imageElement);
                if (faces.length > 0) {
                    return true; // Definitely a person
                }
                // No face detected - could still be a person (back turned, etc)
                // Fall through to heuristic check
            } catch (e) {
                // Detection error, fall through
            }
        }
        
        // PRIORITY 2: Strict skin tone + shape heuristic
        // Only return TRUE if we're VERY confident it's a person
        // When in doubt, return FALSE (use RMBG which works for everything)
        return detectPersonStrict(imageElement);
    }

    function detectPersonStrict(imageElement) {
        // STRICT person detection - only return true if very confident
        // Better to use RMBG (works for both) than misroute to RVM
        const canvas = document.createElement('canvas');
        const size = 150;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, size, size);
        
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        
        let skinPixels = 0;
        let faceRegionSkin = 0;
        const total = size * size;
        
        // Check skin tone in different regions
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const r = data[i], g = data[i+1], b = data[i+2];
                
                // Stricter skin tone detection
                // Must have: R > G > B, specific ranges, and not too saturated
                const isSkin = (
                    r > 100 && r < 255 &&
                    g > 50 && g < 200 &&
                    b > 30 && b < 180 &&
                    r > g && g > b &&
                    (r - g) > 10 && (r - g) < 80 &&
                    (r - b) > 20 && (r - b) < 120
                );
                
                if (isSkin) {
                    skinPixels++;
                    // Check if skin is in typical face region (upper-center)
                    if (y < size * 0.6 && x > size * 0.25 && x < size * 0.75) {
                        faceRegionSkin++;
                    }
                }
            }
        }
        
        const skinRatio = skinPixels / total;
        const faceRegionRatio = faceRegionSkin / (size * 0.6 * size * 0.5);
        
        // STRICT: Need significant skin AND concentrated in face region
        // Threshold raised from 5% to 12% overall AND 15% in face region
        const isPerson = skinRatio > 0.12 && faceRegionRatio > 0.15;
        
        return isPerson;
    }

    // ── Download Progress Persistence ──────────────────────────────────────
    
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for persistence
    
    function getDownloadProgress(modelKey) {
        try {
            const data = localStorage.getItem(`dl_progress_${modelKey}`);
            return data ? JSON.parse(data) : null;
        } catch { return null; }
    }
    
    function saveDownloadProgress(modelKey, bytesReceived, totalBytes) {
        try {
            localStorage.setItem(`dl_progress_${modelKey}`, JSON.stringify({
                received: bytesReceived,
                total: totalBytes,
                timestamp: Date.now()
            }));
        } catch {}
    }
    
    function clearDownloadProgress(modelKey) {
        try {
            localStorage.removeItem(`dl_progress_${modelKey}`);
        } catch {}
    }
    
    async function cachePartialDownload(modelKey, chunks, bytesReceived) {
        // Store partial download for resume capability
        try {
            const cache = await caches.open(CACHE_NAME + '-partial');
            const combined = new Uint8Array(bytesReceived);
            let pos = 0;
            for (const chunk of chunks) {
                combined.set(chunk, pos);
                pos += chunk.length;
            }
            const response = new Response(combined.buffer, {
                headers: { 
                    'Content-Type': 'application/octet-stream',
                    'X-Partial': 'true',
                    'X-Bytes-Received': bytesReceived.toString()
                }
            });
            await cache.put(modelKey, response);
        } catch {}
    }
    
    async function getPartialDownload(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME + '-partial');
            const response = await cache.match(modelKey);
            if (response && response.headers.get('X-Partial') === 'true') {
                const bytesReceived = parseInt(response.headers.get('X-Bytes-Received') || '0');
                const buffer = await response.arrayBuffer();
                return { buffer: new Uint8Array(buffer), bytesReceived };
            }
        } catch {}
        return null;
    }
    
    async function clearPartialDownload(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME + '-partial');
            await cache.delete(modelKey);
        } catch {}
    }

    // ── Model Download with Resume Support ────────────────────────────────────

    async function downloadModel(modelKey, modelUrl, onProgress) {
        // Check cache first (complete download)
        let arrayBuffer = await getCachedModel(modelKey);
        
        if (arrayBuffer) {
            if (onProgress) onProgress(1);
            return arrayBuffer;
        }
        
        // Check for partial download to resume
        const partial = await getPartialDownload(modelKey);
        let startByte = 0;
        let existingChunks = [];
        
        if (partial && partial.bytesReceived > 0) {
            startByte = partial.bytesReceived;
            existingChunks = [partial.buffer];
        }
        
        // Set up fetch with Range header for resume
        const headers = {};
        if (startByte > 0) {
            headers['Range'] = `bytes=${startByte}-`;
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 180000);
        
        const response = await fetch(modelUrl, { 
            signal: controller.signal,
            headers: headers
        });
        clearTimeout(timeoutId);
        
        const isPartialResponse = response.status === 206;
        const contentLength = +response.headers.get('Content-Length') || 0;
        const totalLength = isPartialResponse ? startByte + contentLength : contentLength;
        
        if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        if (startByte > 0 && !isPartialResponse) {
            startByte = 0;
            existingChunks = [];
        }
        
        const reader = response.body.getReader();
        let received = startByte;
        const chunks = [...existingChunks];
        const startTime = Date.now();
        let lastSaveTime = Date.now();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            received += value.length;
            
            if (onProgress && totalLength) {
                onProgress(received / totalLength);
            }
            
            if (Date.now() - lastSaveTime > 5000) {
                await cachePartialDownload(modelKey, chunks, received);
                saveDownloadProgress(modelKey, received, totalLength);
                lastSaveTime = Date.now();
            }
            
            if (Date.now() - startTime > 600000) {
                await cachePartialDownload(modelKey, chunks, received);
                saveDownloadProgress(modelKey, received, totalLength);
                throw new Error('Download taking too long, will resume later');
            }
        }
        
        // Combine all chunks
        arrayBuffer = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
            arrayBuffer.set(chunk, pos);
            pos += chunk.length;
        }
        arrayBuffer = arrayBuffer.buffer;
        
        // Cache complete download
        await cacheModel(modelKey, arrayBuffer);
        await clearPartialDownload(modelKey);
        clearDownloadProgress(modelKey);
        
        return arrayBuffer;
    }
    
    // ── ONNX Session Creation ────────────────────────────────────────────────
    
    async function createONNXSession(arrayBuffer) {
        if (typeof ort === 'undefined') {
            throw new Error('ONNX Runtime not loaded');
        }
        
        const session = await ort.InferenceSession.create(arrayBuffer, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
            executionProviderOptions: {
                wasm: {
                    numThreads: 1
                }
            }
        });
        
        return session;
    }

    // ── RVM Inference (Worker-enabled for non-blocking UI) ─────────────────

    async function runRVM(imageElement, downsampleRatio = 0.5) {
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;
        
        let alphaMask;
        
        // Try worker first (non-blocking)
        if (_workerReady && _worker) {
            try {
                const result = await postToWorker('runRVM', {
                    imageData: data,
                    width: W,
                    height: H,
                    downsampleRatio: downsampleRatio
                });
                alphaMask = result.alphaMask;
            } catch (e) {
                console.warn('[ClientAI] Worker RVM failed, using main thread:', e.message);
                alphaMask = null;
            }
        }
        
        // Fallback to main thread
        if (!alphaMask) {
            if (!_rvmSession) throw new Error('RVM not loaded');
            
            const src = new Float32Array(3 * H * W);
            for (let i = 0; i < H * W; i++) {
                src[i] = data[i * 4] / 255;
                src[H * W + i] = data[i * 4 + 1] / 255;
                src[2 * H * W + i] = data[i * 4 + 2] / 255;
            }
            
            const srcTensor = new ort.Tensor('float32', src, [1, 3, H, W]);
            const r = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
            const dsr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);
            
            const results = await _rvmSession.run({
                src: srcTensor,
                r1i: r, r2i: r, r3i: r, r4i: r,
                downsample_ratio: dsr
            });
            
            alphaMask = results.pha.data;
        }
        
        // Apply alpha to image
        for (let i = 0; i < H * W; i++) {
            data[i * 4 + 3] = Math.round(alphaMask[i] * 255);
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── RMBG Inference (Worker-enabled for non-blocking UI) ────────────────

    async function runRMBG(imageElement) {
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;
        
        let alphaMask;
        
        // Try worker first (non-blocking - keeps UI responsive)
        if (_workerReady && _worker) {
            try {
                console.log('[ClientAI] Running RMBG in worker (non-blocking)...');
                const result = await postToWorker('runRMBG', {
                    imageData: data,
                    width: W,
                    height: H
                });
                alphaMask = result.alphaMask;
                console.log('[ClientAI] Worker RMBG completed!');
            } catch (e) {
                console.warn('[ClientAI] Worker RMBG failed, using main thread:', e.message);
                alphaMask = null;
            }
        }
        
        // Fallback to main thread (will block UI)
        if (!alphaMask) {
            if (!_rmbgSession) throw new Error('RMBG not loaded');
            console.log('[ClientAI] Running RMBG on main thread (may lag)...');
            
            const SIZE = 1024;
            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = SIZE;
            resizeCanvas.height = SIZE;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(imageElement, 0, 0, SIZE, SIZE);
            
            const resizedData = resizeCtx.getImageData(0, 0, SIZE, SIZE);
            const pixels = resizedData.data;
            
            // Prepare tensor
            const input = new Float32Array(3 * SIZE * SIZE);
            for (let i = 0; i < SIZE * SIZE; i++) {
                input[i] = pixels[i * 4] / 255 - 0.5;
                input[SIZE * SIZE + i] = pixels[i * 4 + 1] / 255 - 0.5;
                input[2 * SIZE * SIZE + i] = pixels[i * 4 + 2] / 255 - 0.5;
            }
            
            const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
            const inputName = _rmbgSession.inputNames[0];
            
            const results = await _rmbgSession.run({ [inputName]: inputTensor });
            
            const outputName = _rmbgSession.outputNames[0];
            const mask = results[outputName].data;
            
            // Normalize and resize mask
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < mask.length; i++) {
                if (mask[i] < min) min = mask[i];
                if (mask[i] > max) max = mask[i];
            }
            const range = max - min || 1;
            
            alphaMask = new Float32Array(W * H);
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const srcX = Math.floor(x * SIZE / W);
                    const srcY = Math.floor(y * SIZE / H);
                    const srcIdx = srcY * SIZE + srcX;
                    alphaMask[y * W + x] = (mask[srcIdx] - min) / range;
                }
            }
        }
        
        // Apply alpha to image
        for (let i = 0; i < W * H; i++) {
            data[i * 4 + 3] = Math.round(alphaMask[i] * 255);
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── Compatibility helpers for HTML init code ──────────────────────────

    function isMobile() {
        return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // ── Public API ────────────────────────────────────────────────────────

    return {
        // State getters
        get isRVMReady() { return _rvmReady; },
        get isRMBGReady() { return _rmbgReady; },
        get isRVMDownloading() { return _rvmDownloading; },
        get isRMBGDownloading() { return _rmbgDownloading; },
        get deviceInfo() { return _deviceInfo; },

        // Compatibility method for HTML init code
        async detectDevice() {
            if (isMobile()) {
                _deviceInfo = { capable: false, isMobile: true, gpu: 'Mobile' };
                return false;
            }
            _deviceInfo = { capable: true, isMobile: false, gpu: 'WASM', gpuShort: 'CPU', dtype: 'fp32' };
            return true;
        },

        // Compatibility method for HTML init code
        async isModelCached() {
            const rvmCached = await isModelCached(MODELS.rvm.id);
            const rmbgCached = await isModelCached(MODELS.rmbg.id);
            return rvmCached || rmbgCached;
        },

        // Compatibility method for HTML init code (maps to loadRVM)
        async initModel(onProgress, quality) {
            await this.loadRVM(onProgress);
            return _rvmReady;
        },

        async init() {
            if (_initPromise) return _initPromise;
            
            _initPromise = (async () => {
                // Initialize web worker for non-blocking inference
                await initWorker();
                
                await initFaceDetector();
                
                // Check what's already cached and load them
                const rvmCached = await isModelCached(MODELS.rvm.id);
                const rmbgCached = await isModelCached(MODELS.rmbg.id);
                
                // Load cached models (fast, from cache)
                const promises = [];
                if (rvmCached && !_rvmReady && !_rvmDownloading) {
                    promises.push(this.loadRVM());
                }
                if (rmbgCached && !_rmbgReady && !_rmbgDownloading) {
                    promises.push(this.loadRMBG());
                }
                await Promise.all(promises);
            })();
            
            return _initPromise;
        },

        async loadRVM(onProgress) {
            if (_rvmReady || _rvmDownloading) return;
            _rvmDownloading = true;
            
            try {
                // Download model (with caching)
                const modelBuffer = await downloadModel(MODELS.rvm.id, MODELS.rvm.url, onProgress);
                
                // Load into worker if available (non-blocking inference)
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { 
                            modelType: 'rvm', 
                            modelBuffer: modelBuffer 
                        });
                        console.log('[ClientAI] RVM loaded into worker');
                    } catch (workerErr) {
                        console.warn('[ClientAI] Worker RVM load failed, will use main thread:', workerErr.message);
                        _workerReady = false; // Disable worker fallback
                    }
                }
                
                // Load on main thread (always, worker is just bonus)
                _rvmSession = await createONNXSession(modelBuffer);
                _rvmReady = true;
            } catch (e) {
                console.error('[ClientAI] RVM load FAILED:', e.message);
                console.error('[ClientAI] Full error:', e);
                _rvmReady = false;
            } finally {
                _rvmDownloading = false;
            }
        },

        async loadRMBG(onProgress) {
            if (_rmbgReady || _rmbgDownloading) return;
            _rmbgDownloading = true;
            
            console.log('[ClientAI] Starting RMBG-1.4 download (40MB)...');
            
            try {
                // Download model (with caching and progress)
                const modelBuffer = await downloadModel(MODELS.rmbg.id, MODELS.rmbg.url, (progress) => {
                    if (onProgress) onProgress(progress);
                    if (progress < 1) {
                        console.log(`[ClientAI] RMBG download: ${Math.round(progress*100)}%`);
                    } else {
                        console.log('[ClientAI] RMBG model downloaded!');
                    }
                });
                
                // Load into worker if available (non-blocking inference)
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { 
                            modelType: 'rmbg', 
                            modelBuffer: modelBuffer 
                        });
                        console.log('[ClientAI] RMBG loaded into worker');
                    } catch (workerErr) {
                        console.warn('[ClientAI] Worker RMBG load failed, will use main thread:', workerErr.message);
                        _workerReady = false; // Disable worker fallback
                    }
                }
                
                // Load on main thread (always, worker is just bonus)
                _rmbgSession = await createONNXSession(modelBuffer);
                _rmbgReady = true;
                console.log('[ClientAI] RMBG ready! Objects will use on-device AI');
            } catch (e) {
                console.error('[ClientAI] RMBG load FAILED:', e.message);
                console.error('[ClientAI] Full error:', e);
                _rmbgReady = false;
            } finally {
                _rmbgDownloading = false;
            }
        },

        async detectPerson(imageElement) {
            return await detectPerson(imageElement);
        },

        async processImage(imageElement, mode = 'fast') {
            /**
             * FINAL ROUTING LOGIC (FIXED):
             * 
             * PRO MODE (high quality):
             * - Always use RMBG-1.4 for both persons AND objects
             * - If RMBG not ready → use SERVER + start RMBG download
             * 
             * FAST MODE (speed):
             * - Person detected → use RVM if ready, otherwise SERVER
             * - Object detected → use RMBG if ready, otherwise SERVER
             */
            
            // First, detect person vs object (only needed for fast mode)
            const isPerson = await detectPerson(imageElement);
            
            if (mode === 'pro') {
                // === PRO MODE: ALWAYS use RMBG-1.4 ===
                if (_rmbgReady && _rmbgSession) {
                    try {
                        const result = await runRMBG(imageElement);
                        return { success: true, dataUrl: result, model: 'rmbg', isPerson, mode: 'pro' };
                    } catch (e) {
                        return { success: false, needsModel: 'rmbg', isPerson, mode: 'pro', error: e.message };
                    }
                } else {
                    // RMBG not ready - use server, start downloading RMBG
                    if (!_rmbgDownloading && !_rmbgReady) {
                        this.loadRMBG();
                    }
                    return { success: false, needsModel: 'rmbg', isPerson, mode: 'pro' };
                }
            } else {
                // === FAST MODE: Smart routing ===
                if (isPerson) {
                    // Person detected → use RVM for speed
                    if (_rvmReady && _rvmSession) {
                        try {
                            const downsample = 0.2; // Fast mode uses 0.2 downsample
                            const result = await runRVM(imageElement, downsample);
                            return { success: true, dataUrl: result, model: 'rvm', isPerson: true, mode: 'fast' };
                        } catch (e) {
                            return { success: false, needsModel: 'rvm', isPerson: true, mode: 'fast', error: e.message };
                        }
                    } else {
                        // RVM not ready - use server, start downloading RVM
                        if (!_rvmDownloading && !_rvmReady) {
                            this.loadRVM();
                        }
                        return { success: false, needsModel: 'rvm', isPerson: true, mode: 'fast' };
                    }
                } else {
                    // Object detected → use RMBG
                    if (_rmbgReady && _rmbgSession) {
                        try {
                            const result = await runRMBG(imageElement);
                            return { success: true, dataUrl: result, model: 'rmbg', isPerson: false, mode: 'fast' };
                        } catch (e) {
                            return { success: false, needsModel: 'rmbg', isPerson: false, mode: 'fast', error: e.message };
                        }
                    } else {
                        // RMBG not ready - use server, start downloading RMBG
                        if (!_rmbgDownloading && !_rmbgReady) {
                            this.loadRMBG();
                        }
                        return { success: false, needsModel: 'rmbg', isPerson: false, mode: 'fast' };
                    }
                }
            }
        },

        getStatus() {
            return {
                rvm: { ready: _rvmReady, downloading: _rvmDownloading, size: MODELS.rvm.size },
                rmbg: { ready: _rmbgReady, downloading: _rmbgDownloading, size: MODELS.rmbg.size }
            };
        }
    };
})();

// Auto-init on load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        ClientProcessor.init();
    });
}
