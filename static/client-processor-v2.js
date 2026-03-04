/**
 * Client-Side Background Remover v2
 * ==================================
 * Smart routing: Person → RVM, Object → RMBG
 * Uses Cache API for fast model storage (no IndexedDB lag)
 * 
 * Flow:
 * 1. On first visit: download RVM (15MB) for persons
 * 2. On first object detected: download RMBG (40MB)
 * 3. While downloading: use server fallback
 */

const ClientProcessor = (() => {
    // Model configs
    const MODELS = {
        rvm: {
            id: 'rvm-mobilenetv3',
            url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
            size: 15,  // MB
            type: 'person'
        },
        rmbg: {
            id: 'rmbg-1.4-quantized', 
            url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
            size: 40,  // MB
            type: 'object'
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

    // ── Cache API helpers (faster than IndexedDB) ─────────────────────────

    async function getCachedModel(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = await cache.match(modelKey);
            if (response) {
                console.log(`[Cache] Found ${modelKey}`);
                return await response.arrayBuffer();
            }
        } catch (e) {
            console.warn('[Cache] Read error:', e);
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
            console.log(`[Cache] Stored ${modelKey} (${(arrayBuffer.byteLength/1e6).toFixed(1)}MB)`);
            return true;
        } catch (e) {
            console.warn('[Cache] Write error:', e);
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

    // ── Face Detection (fast person vs object) ────────────────────────────

    async function initFaceDetector() {
        // Try browser's FaceDetector API first (Chrome 70+)
        if ('FaceDetector' in window) {
            try {
                // Check if FaceDetector is actually supported (some browsers have it but not enabled)
                const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
                _faceDetector = detector;
                _faceDetectorSupported = true;
                console.log('[FaceDetect] Using browser FaceDetector API');
                return true;
            } catch (e) {
                console.warn('[FaceDetect] Browser API not available:', e);
            }
        }
        
        // Fallback: simple heuristic (skin tone detection)
        _faceDetectorSupported = false;
        console.log('[FaceDetect] Using skin-tone heuristic fallback');
        return false;
    }

    async function detectPerson(imageElement) {
        const t0 = performance.now();
        
        if (_faceDetector && _faceDetectorSupported) {
            try {
                const faces = await _faceDetector.detect(imageElement);
                const isPerson = faces.length > 0;
                console.log(`[FaceDetect] ${isPerson ? 'Person' : 'Object'} (${(performance.now()-t0).toFixed(0)}ms, ${faces.length} faces)`);
                return isPerson;
            } catch (e) {
                console.warn('[FaceDetect] Detection error:', e);
            }
        }
        
        // Fallback: skin tone heuristic
        return detectPersonBySkinTone(imageElement);
    }

    function detectPersonBySkinTone(imageElement) {
        // Quick skin-tone detection heuristic
        const canvas = document.createElement('canvas');
        const size = 100;  // Sample at 100x100 for speed
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, size, size);
        
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        
        let skinPixels = 0;
        const total = size * size;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            // Simple skin tone detection (works for various skin tones)
            if (r > 95 && g > 40 && b > 20 &&
                r > g && r > b &&
                Math.abs(r - g) > 15 &&
                r - g > 15 && r - b > 15) {
                skinPixels++;
            }
        }
        
        const skinRatio = skinPixels / total;
        const isPerson = skinRatio > 0.05;  // >5% skin pixels = likely person
        console.log(`[FaceDetect] Skin heuristic: ${(skinRatio*100).toFixed(1)}% → ${isPerson ? 'Person' : 'Object'}`);
        return isPerson;
    }

    // ── Model Loading ─────────────────────────────────────────────────────

    async function loadONNXSession(modelKey, modelUrl, onProgress) {
        // Check cache first
        let arrayBuffer = await getCachedModel(modelKey);
        
        if (!arrayBuffer) {
            // Download with progress
            console.log(`[Model] Downloading ${modelKey}...`);
            const response = await fetch(modelUrl);
            const reader = response.body.getReader();
            const contentLength = +response.headers.get('Content-Length') || 0;
            
            let received = 0;
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (onProgress && contentLength) {
                    onProgress(received / contentLength);
                }
            }
            
            arrayBuffer = new Uint8Array(received);
            let pos = 0;
            for (const chunk of chunks) {
                arrayBuffer.set(chunk, pos);
                pos += chunk.length;
            }
            arrayBuffer = arrayBuffer.buffer;
            
            // Cache for next time
            await cacheModel(modelKey, arrayBuffer);
        }
        
        // Create ONNX session
        if (typeof ort === 'undefined') {
            throw new Error('ONNX Runtime not loaded');
        }
        
        const session = await ort.InferenceSession.create(arrayBuffer, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        
        console.log(`[Model] ${modelKey} ready`);
        return session;
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
        
        const t0 = performance.now();
        const results = await _rvmSession.run({
            src: srcTensor,
            r1i: r, r2i: r, r3i: r, r4i: r,
            downsample_ratio: dsr
        });
        console.log(`[RVM] Inference: ${(performance.now()-t0).toFixed(0)}ms`);
        
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
        
        const t0 = performance.now();
        const inputName = _rmbgSession.inputNames[0];
        const results = await _rmbgSession.run({ [inputName]: inputTensor });
        console.log(`[RMBG] Inference: ${(performance.now()-t0).toFixed(0)}ms`);
        
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

    // ── Public API ────────────────────────────────────────────────────────

    return {
        get isRVMReady() { return _rvmReady; },
        get isRMBGReady() { return _rmbgReady; },
        get isRVMDownloading() { return _rvmDownloading; },
        get isRMBGDownloading() { return _rmbgDownloading; },

        async init() {
            await initFaceDetector();
            
            // Check what's already cached
            const rvmCached = await isModelCached(MODELS.rvm.id);
            const rmbgCached = await isModelCached(MODELS.rmbg.id);
            console.log(`[Init] Cached: RVM=${rvmCached}, RMBG=${rmbgCached}`);
            
            // Load cached models immediately
            if (rvmCached && !_rvmReady) {
                this.loadRVM();
            }
            if (rmbgCached && !_rmbgReady) {
                this.loadRMBG();
            }
        },

        async loadRVM(onProgress) {
            if (_rvmReady || _rvmDownloading) return;
            _rvmDownloading = true;
            
            try {
                _rvmSession = await loadONNXSession(MODELS.rvm.id, MODELS.rvm.url, onProgress);
                _rvmReady = true;
            } catch (e) {
                console.error('[RVM] Load failed:', e);
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
                console.error('[RMBG] Load failed:', e);
            } finally {
                _rmbgDownloading = false;
            }
        },

        async detectPerson(imageElement) {
            return await detectPerson(imageElement);
        },

        async processImage(imageElement, mode = 'fast') {
            /**
             * Smart processing:
             * 1. Detect person vs object
             * 2. Route to RVM (person) or RMBG (object)
             * 3. If model not ready, return null (caller uses server)
             */
            const isPerson = await detectPerson(imageElement);
            const downsample = mode === 'fast' ? 0.2 : 0.5;
            
            if (isPerson) {
                if (!_rvmReady) {
                    console.log('[Process] RVM not ready, use server');
                    return { success: false, needsModel: 'rvm', isPerson: true };
                }
                const result = await runRVM(imageElement, downsample);
                return { success: true, dataUrl: result, model: 'rvm', isPerson: true };
            } else {
                if (!_rmbgReady) {
                    console.log('[Process] RMBG not ready, use server');
                    // Start downloading RMBG for next time
                    if (!_rmbgDownloading) {
                        this.loadRMBG();
                    }
                    return { success: false, needsModel: 'rmbg', isPerson: false };
                }
                const result = await runRMBG(imageElement);
                return { success: true, dataUrl: result, model: 'rmbg', isPerson: false };
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
