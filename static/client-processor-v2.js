/**
 * Client-Side Background Remover v2.1
 * ====================================
 * Smart routing: Person → RVM, Object → RMBG
 * Uses Cache API for fast model storage
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
            id: 'rvm-mobilenetv3-v2',
            url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
            size: 15  // MB
        },
        rmbg: {
            id: 'rmbg-1.4-quantized-v2', 
            url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
            size: 40  // MB
        }
    };

    const CACHE_NAME = 'bg-remover-models-v3';
    
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

    // ── Model Loading with Resume Support ────────────────────────────────────

    async function loadONNXSession(modelKey, modelUrl, onProgress) {
        // Check cache first (complete download)
        let arrayBuffer = await getCachedModel(modelKey);
        
        if (!arrayBuffer) {
            // Check for partial download to resume
            const partial = await getPartialDownload(modelKey);
            let startByte = 0;
            let existingChunks = [];
            
            if (partial && partial.bytesReceived > 0) {
                // We have a partial download - try to resume
                startByte = partial.bytesReceived;
                existingChunks = [partial.buffer];
            }
            
            try {
                // Set up fetch with Range header for resume
                const headers = {};
                if (startByte > 0) {
                    headers['Range'] = `bytes=${startByte}-`;
                }
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                }, 180000); // 3 minute initial timeout
                
                const response = await fetch(modelUrl, { 
                    signal: controller.signal,
                    headers: headers
                });
                clearTimeout(timeoutId);
                
                // Check if server supports range requests
                const isPartialResponse = response.status === 206;
                const contentLength = +response.headers.get('Content-Length') || 0;
                const totalLength = isPartialResponse ? startByte + contentLength : contentLength;
                
                if (!response.ok && response.status !== 206) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                // If server doesn't support range, start fresh
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
                    
                    // Save partial progress every 5 seconds for resume on tab close
                    if (Date.now() - lastSaveTime > 5000) {
                        await cachePartialDownload(modelKey, chunks, received);
                        saveDownloadProgress(modelKey, received, totalLength);
                        lastSaveTime = Date.now();
                    }
                    
                    // Check if download is taking too long (>10 minutes total)
                    if (Date.now() - startTime > 600000) {
                        // Save progress before giving up
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
                
                // Clear partial download data
                await clearPartialDownload(modelKey);
                clearDownloadProgress(modelKey);
                
            } catch (error) {
                // Download failed - progress already saved for resume
                throw error;
            }
        }
        
        // Create ONNX session
        if (typeof ort === 'undefined') {
            throw new Error('ONNX Runtime not loaded');
        }
        
        try {
            const session = await ort.InferenceSession.create(arrayBuffer, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            return session;
        } catch (error) {
            // Session creation failed
            throw error;
        }
    }

    // ── RVM Inference ─────────────────────────────────────────────────────

    async function runRVM(imageElement, downsampleRatio = 0.5) {
        if (!_rvmSession) throw new Error('RVM not loaded');
        
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;
        
        // Prepare src tensor (1, 3, H, W) normalized to 0-1
        const src = new Float32Array(3 * H * W);
        for (let i = 0; i < H * W; i++) {
            src[i] = data[i * 4] / 255;           // R
            src[H * W + i] = data[i * 4 + 1] / 255;  // G
            src[2 * H * W + i] = data[i * 4 + 2] / 255;  // B
        }
        
        // RVM inputs
        const srcTensor = new ort.Tensor('float32', src, [1, 3, H, W]);
        const r = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
        const dsr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);
        
        const results = await _rvmSession.run({
            src: srcTensor,
            r1i: r, r2i: r, r3i: r, r4i: r,
            downsample_ratio: dsr
        });
        
        // Get alpha from output
        const alpha = results.pha.data;
        
        // Apply alpha to image
        for (let i = 0; i < H * W; i++) {
            data[i * 4 + 3] = Math.round(alpha[i] * 255);
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── RMBG Inference ────────────────────────────────────────────────────

    async function runRMBG(imageElement) {
        if (!_rmbgSession) throw new Error('RMBG not loaded');
        
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        const SIZE = 1024;
        
        // Resize to 1024x1024 for inference
        canvas.width = SIZE;
        canvas.height = SIZE;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, SIZE, SIZE);
        
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
        const data = imageData.data;
        
        // Prepare tensor (1, 3, 1024, 1024) normalized: (x/255 - 0.5)
        const input = new Float32Array(3 * SIZE * SIZE);
        for (let i = 0; i < SIZE * SIZE; i++) {
            input[i] = data[i * 4] / 255 - 0.5;              // R
            input[SIZE * SIZE + i] = data[i * 4 + 1] / 255 - 0.5;  // G
            input[2 * SIZE * SIZE + i] = data[i * 4 + 2] / 255 - 0.5;  // B
        }
        
        const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
        
        const inputName = _rmbgSession.inputNames[0];
        const results = await _rmbgSession.run({ [inputName]: inputTensor });
        
        // Get mask output
        const outputName = _rmbgSession.outputNames[0];
        const mask = results[outputName].data;
        
        // Normalize mask to 0-255
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] < min) min = mask[i];
            if (mask[i] > max) max = mask[i];
        }
        const range = max - min || 1;
        
        // Create output at original size
        const outCanvas = document.createElement('canvas');
        outCanvas.width = W;
        outCanvas.height = H;
        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(imageElement, 0, 0, W, H);
        
        const outData = outCtx.getImageData(0, 0, W, H);
        const outPixels = outData.data;
        
        // Resize mask from 1024x1024 to WxH
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const srcX = Math.floor(x * SIZE / W);
                const srcY = Math.floor(y * SIZE / H);
                const srcIdx = srcY * SIZE + srcX;
                const alpha = ((mask[srcIdx] - min) / range) * 255;
                outPixels[(y * W + x) * 4 + 3] = Math.round(alpha);
            }
        }
        
        outCtx.putImageData(outData, 0, 0);
        return outCanvas.toDataURL('image/png');
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
                _rvmSession = await loadONNXSession(MODELS.rvm.id, MODELS.rvm.url, onProgress);
                _rvmReady = true;
            } catch (e) {
                // RVM load failed
            } finally {
                _rvmDownloading = false;
            }
        },

        async loadRMBG(onProgress) {
            if (_rmbgReady || _rmbgDownloading) return;
            _rmbgDownloading = true;
            
            try {
                _rmbgSession = await loadONNXSession(MODELS.rmbg.id, MODELS.rmbg.url, onProgress);
                _rmbgReady = true;
            } catch (e) {
                // RMBG load failed
            } finally {
                _rmbgDownloading = false;
            }
        },

        async detectPerson(imageElement) {
            return await detectPerson(imageElement);
        },

        async processImage(imageElement, mode = 'fast') {
            /**
             * CRITICAL ROUTING LOGIC:
             * 1. Detect if image contains a person
             * 2. Route to correct model:
             *    - Person + RVM ready → RVM locally
             *    - Person + RVM not ready → SERVER (never use RMBG for persons)
             *    - Object + RMBG ready → RMBG locally
             *    - Object + RMBG not ready → SERVER + start RMBG download
             */
            
            // First, detect person vs object
            const isPerson = await detectPerson(imageElement);
            const downsample = mode === 'fast' ? 0.2 : 0.5;
            
            if (isPerson) {
                // === PERSON DETECTED ===
                // Only use RVM if it's ready, otherwise SERVER
                // NEVER fall back to RMBG for persons
                if (_rvmReady && _rvmSession) {
                    try {
                        const result = await runRVM(imageElement, downsample);
                        return { success: true, dataUrl: result, model: 'rvm', isPerson: true };
                    } catch (e) {
                        return { success: false, needsModel: 'rvm', isPerson: true, error: e.message };
                    }
                } else {
                    // RVM not ready - use server, start downloading RVM
                    if (!_rvmDownloading && !_rvmReady) {
                        this.loadRVM();
                    }
                    return { success: false, needsModel: 'rvm', isPerson: true };
                }
            } else {
                // === OBJECT DETECTED ===
                // Only use RMBG if it's ready, otherwise SERVER
                // NEVER fall back to RVM for objects
                if (_rmbgReady && _rmbgSession) {
                    try {
                        const result = await runRMBG(imageElement);
                        return { success: true, dataUrl: result, model: 'rmbg', isPerson: false };
                    } catch (e) {
                        return { success: false, needsModel: 'rmbg', isPerson: false, error: e.message };
                    }
                } else {
                    // RMBG not ready - use server, start downloading RMBG
                    if (!_rmbgDownloading && !_rmbgReady) {
                        this.loadRMBG();
                    }
                    return { success: false, needsModel: 'rmbg', isPerson: false };
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
