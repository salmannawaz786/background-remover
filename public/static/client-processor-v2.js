/**
 * Client-Side Background Remover v3.0
 * ====================================
 * Smart routing:
 *   FAST mode: Person -> RVM, Object -> server (U2Net-P on server)
 *   PRO mode (PC): BREFNet Lite ONNX (98MB) client-side
 *   PRO mode (Mobile): RMBG-1.4 (42MB) client-side
 *   Fallback: always server
 *
 * Model download happens in background after first pro request.
 * Uses Cache API for fast model storage and Web Workers for non-blocking inference.
 */

const ClientProcessor = (() => {
    const API_BASE = (typeof window !== 'undefined' && window.location.hostname !== 'localhost')
        ? 'https://bgremover.sallulabs.com'
        : 'http://localhost:5001';

    const MODELS = {
        rvm: {
            id: 'rvm-mobilenetv3',
            url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
            size: 15
        },
        rmbg: {
            id: 'rmbg-1.4-quantized',
            url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
            size: 40
        },
        brefnet: {
            id: 'brefnet-lite-fp16',
            url: `${API_BASE}/models/model_fp16.onnx`,
            size: 98
        }
    };

    const CACHE_NAME = 'bg-remover-models-v3';

    let _rvmSession = null;
    let _rmbgSession = null;
    let _brefnetSession = null;
    let _rvmReady = false;
    let _rmbgReady = false;
    let _brefnetReady = false;
    let _rvmDownloading = false;
    let _rmbgDownloading = false;
    let _brefnetDownloading = false;
    let _faceDetector = null;
    let _faceDetectorSupported = false;
    let _deviceInfo = { capable: true, isMobile: false };
    let _initPromise = null;

    let _worker = null;
    let _workerReady = false;
    let _workerHasRVM = false;
    let _workerHasRMBG = false;
    let _workerHasBREFNet = false;
    let _workerCallbacks = {};
    let _workerMessageId = 0;

    let _onProgressCallback = null;

    // ── Web Worker Setup ─────────────────────────────────────────────────────

    function initWorker() {
        if (_worker) return Promise.resolve();
        return new Promise((resolve) => {
            try {
                _worker = new Worker('/static/onnx-worker.js');
                _worker.onmessage = (e) => {
                    const { id, error, ...data } = e.data;
                    const callback = _workerCallbacks[id];
                    if (callback) {
                        delete _workerCallbacks[id];
                        if (error) callback.reject(new Error(error));
                        else callback.resolve(data);
                    }
                };
                _worker.onerror = (e) => console.error('[Worker] Error:', e.message);
                _workerReady = true;
                resolve();
            } catch (e) {
                console.warn('[Worker] Failed, using main thread:', e.message);
                _workerReady = false;
                resolve();
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

    // ── Cache API helpers ────────────────────────────────────────────────────

    async function getCachedModel(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const response = await cache.match(modelKey);
            if (response) return await response.arrayBuffer();
        } catch (e) { /* ignore */ }
        return null;
    }

    async function cacheModel(modelKey, arrayBuffer) {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(modelKey, new Response(arrayBuffer, {
                headers: { 'Content-Type': 'application/octet-stream' }
            }));
            return true;
        } catch (e) { return false; }
    }

    async function isModelCached(modelKey) {
        try {
            const cache = await caches.open(CACHE_NAME);
            return !!(await cache.match(modelKey));
        } catch (e) { return false; }
    }

    // ── Face Detection ───────────────────────────────────────────────────────

    async function initFaceDetector() {
        if ('FaceDetector' in window) {
            try {
                _faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
                _faceDetectorSupported = true;
                return true;
            } catch (e) { /* ignore */ }
        }
        _faceDetectorSupported = false;
        return false;
    }

    async function detectPerson(imageElement) {
        if (_faceDetector && _faceDetectorSupported) {
            try {
                const faces = await _faceDetector.detect(imageElement);
                if (faces.length > 0) return true;
            } catch (e) { /* fall through */ }
        }
        return detectPersonStrict(imageElement);
    }

    function detectPersonStrict(imageElement) {
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
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const r = data[i], g = data[i+1], b = data[i+2];
                const isSkin = (
                    r > 100 && r < 255 && g > 50 && g < 200 && b > 30 && b < 180 &&
                    r > g && g > b && (r - g) > 10 && (r - g) < 80 && (r - b) > 20 && (r - b) < 120
                );
                if (isSkin) {
                    skinPixels++;
                    if (y < size * 0.6 && x > size * 0.25 && x < size * 0.75) faceRegionSkin++;
                }
            }
        }
        const skinRatio = skinPixels / total;
        const faceRegionRatio = faceRegionSkin / (size * 0.6 * size * 0.5);
        return skinRatio > 0.12 && faceRegionRatio > 0.15;
    }

    // ── Model Download ───────────────────────────────────────────────────────

    async function downloadModel(modelKey, modelUrl, onProgress) {
        let arrayBuffer = await getCachedModel(modelKey);
        if (arrayBuffer) {
            if (onProgress) onProgress(1);
            return arrayBuffer;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000);

        try {
            const response = await fetch(modelUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            const contentLength = +response.headers.get('Content-Length') || 0;
            const reader = response.body.getReader();
            let received = 0;
            const chunks = [];
            const startTime = Date.now();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (onProgress && contentLength) onProgress(received / contentLength);
                if (Date.now() - startTime > 600000) throw new Error('Download timeout');
            }

            arrayBuffer = new Uint8Array(received);
            let pos = 0;
            for (const chunk of chunks) {
                arrayBuffer.set(chunk, pos);
                pos += chunk.length;
            }
            arrayBuffer = arrayBuffer.buffer;

            await cacheModel(modelKey, arrayBuffer);
            return arrayBuffer;
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    }

    // ── ONNX Session ─────────────────────────────────────────────────────────

    async function createONNXSession(arrayBuffer) {
        if (typeof ort === 'undefined') throw new Error('ONNX Runtime not loaded');
        return await ort.InferenceSession.create(arrayBuffer, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
            executionProviderOptions: { wasm: { numThreads: 1 } }
        });
    }

    // ── RVM Inference ────────────────────────────────────────────────────────

    async function runRVM(imageElement, downsampleRatio = 0.5) {
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;

        let alphaMask;
        if (_workerReady && _worker && _workerHasRVM) {
            try {
                const result = await postToWorker('runRVM', { imageData: data, width: W, height: H, downsampleRatio });
                alphaMask = result.alphaMask;
            } catch (e) { alphaMask = null; }
        }

        if (!alphaMask) {
            if (!_rvmSession) throw new Error('RVM not available');
            const src = new Float32Array(3 * H * W);
            for (let i = 0; i < H * W; i++) {
                src[i] = data[i * 4] / 255;
                src[H * W + i] = data[i * 4 + 1] / 255;
                src[2 * H * W + i] = data[i * 4 + 2] / 255;
            }
            const srcTensor = new ort.Tensor('float32', src, [1, 3, H, W]);
            const r = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
            const dsr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);
            const results = await _rvmSession.run({ src: srcTensor, r1i: r, r2i: r, r3i: r, r4i: r, downsample_ratio: dsr });
            alphaMask = results.pha.data;
        }

        for (let i = 0; i < H * W; i++) {
            data[i * 4 + 3] = Math.round(alphaMask[i] * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── RMBG Inference ───────────────────────────────────────────────────────

    async function runRMBG(imageElement) {
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;

        let alphaMask;
        if (_workerReady && _worker && _workerHasRMBG) {
            try {
                const result = await postToWorker('runRMBG', { imageData: data, width: W, height: H });
                alphaMask = result.alphaMask;
            } catch (e) { alphaMask = null; }
        }

        if (!alphaMask) {
            if (!_rmbgSession) throw new Error('RMBG not available');
            const SIZE = 1024;
            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = SIZE; resizeCanvas.height = SIZE;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(imageElement, 0, 0, SIZE, SIZE);
            const resizedData = resizeCtx.getImageData(0, 0, SIZE, SIZE);
            const pixels = resizedData.data;

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
                    alphaMask[y * W + x] = (mask[srcY * SIZE + srcX] - min) / range;
                }
            }
        }

        for (let i = 0; i < W * H; i++) {
            data[i * 4 + 3] = Math.round(alphaMask[i] * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── BREFNet Inference (PC Pro) ───────────────────────────────────────────

    async function runBREFNet(imageElement) {
        const canvas = document.createElement('canvas');
        const W = imageElement.naturalWidth || imageElement.width;
        const H = imageElement.naturalHeight || imageElement.height;
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;

        let alphaMask;
        if (_workerReady && _worker && _workerHasBREFNet) {
            try {
                const result = await postToWorker('runBREFNet', { imageData: data, width: W, height: H });
                alphaMask = result.alphaMask;
            } catch (e) { alphaMask = null; }
        }

        if (!alphaMask) {
            if (!_brefnetSession) throw new Error('BREFNet not available');
            const SIZE = 512;
            const MEAN = [0.485, 0.456, 0.406];
            const STD = [0.229, 0.224, 0.225];

            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = SIZE; resizeCanvas.height = SIZE;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(imageElement, 0, 0, SIZE, SIZE);
            const resizedData = resizeCtx.getImageData(0, 0, SIZE, SIZE);
            const pixels = resizedData.data;

            const input = new Float32Array(3 * SIZE * SIZE);
            for (let i = 0; i < SIZE * SIZE; i++) {
                input[i] = (pixels[i * 4] / 255 - MEAN[0]) / STD[0];
                input[SIZE * SIZE + i] = (pixels[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
                input[2 * SIZE * SIZE + i] = (pixels[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
            }

            const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
            const results = await _brefnetSession.run({ input_image: inputTensor });
            const raw = results.output_image.data;

            alphaMask = new Float32Array(W * H);
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const srcX = Math.floor(x * SIZE / W);
                    const srcY = Math.floor(y * SIZE / H);
                    const logit = raw[srcY * SIZE + srcX];
                    alphaMask[y * W + x] = 1 / (1 + Math.exp(-logit));
                }
            }
        }

        for (let i = 0; i < W * H; i++) {
            data[i * 4 + 3] = Math.round(alphaMask[i] * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function isMobile() {
        return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    let _gpuCapable = null;

    function detectGPUCapability() {
        if (_gpuCapable !== null) return _gpuCapable;
        if (typeof navigator === 'undefined') return (_gpuCapable = false);
        if (navigator.gpu) return (_gpuCapable = true); // WebGPU
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return (_gpuCapable = false);
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            _gpuCapable = !/swiftshader|software|llvmpipe|basic render/i.test(String(renderer || ''));
        } catch (e) {
            _gpuCapable = false;
        }
        return _gpuCapable;
    }

    function getProModelForDevice() {
        // Desktop, or any GPU-capable mobile device -> BREFNet Lite (best quality).
        // Mobile without GPU support (e.g. budget Chinese phones) -> RMBG-1.4.
        if (!isMobile()) return 'brefnet';
        return detectGPUCapability() ? 'brefnet' : 'rmbg';
    }

    // ── Public API ───────────────────────────────────────────────────────────

    return {
        get isRVMReady() { return _rvmReady; },
        get isBREFNetReady() { return _brefnetReady; },
        get isRMBGReady() { return _rmbgReady; },
        get deviceInfo() { return _deviceInfo; },

        set onProgress(fn) { _onProgressCallback = fn; },

        isMobile() { return isMobile(); },

        async init() {
            if (_initPromise) return _initPromise;
            _initPromise = (async () => {
                await initWorker();
                await initFaceDetector();
                const mobile = isMobile();
                const gpuCapable = mobile ? detectGPUCapability() : true;
                const proModel = getProModelForDevice();
                _deviceInfo = { capable: true, isMobile: mobile, gpuCapable, proModel, dtype: proModel === 'brefnet' ? 'fp16' : 'fp32' };
            })();
            return _initPromise;
        },

        async loadBREFNet(onProgress) {
            if (_brefnetReady || _brefnetDownloading) return;
            _brefnetDownloading = true;
            try {
                const modelBuffer = await downloadModel(MODELS.brefnet.id, MODELS.brefnet.url, onProgress);
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { modelType: 'brefnet', modelBuffer });
                        _workerHasBREFNet = true;
                    } catch (e) {
                        console.warn('[ClientAI] Worker BREFNet load failed:', e.message);
                    }
                }
                if (!_workerHasBREFNet) {
                    _brefnetSession = await createONNXSession(modelBuffer);
                }
                _brefnetReady = true;
            } catch (e) {
                console.error('[ClientAI] BREFNet load FAILED:', e.message);
                _brefnetReady = false;
            } finally {
                _brefnetDownloading = false;
            }
        },

        async loadRMBG(onProgress) {
            if (_rmbgReady || _rmbgDownloading) return;
            _rmbgDownloading = true;
            try {
                const modelBuffer = await downloadModel(MODELS.rmbg.id, MODELS.rmbg.url, onProgress);
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { modelType: 'rmbg', modelBuffer });
                        _workerHasRMBG = true;
                    } catch (e) {
                        console.warn('[ClientAI] Worker RMBG load failed:', e.message);
                    }
                }
                if (!_workerHasRMBG) {
                    _rmbgSession = await createONNXSession(modelBuffer);
                }
                _rmbgReady = true;
            } catch (e) {
                console.error('[ClientAI] RMBG load FAILED:', e.message);
                _rmbgReady = false;
            } finally {
                _rmbgDownloading = false;
            }
        },

        async loadRVM(onProgress) {
            if (_rvmReady || _rvmDownloading) return;
            _rvmDownloading = true;
            try {
                const modelBuffer = await downloadModel(MODELS.rvm.id, MODELS.rvm.url, onProgress);
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { modelType: 'rvm', modelBuffer });
                        _workerHasRVM = true;
                    } catch (e) {
                        console.warn('[ClientAI] Worker RVM load failed:', e.message);
                    }
                }
                if (!_workerHasRVM) {
                    _rvmSession = await createONNXSession(modelBuffer);
                }
                _rvmReady = true;
            } catch (e) {
                console.error('[ClientAI] RVM load FAILED:', e.message);
                _rvmReady = false;
            } finally {
                _rvmDownloading = false;
            }
        },

        isModelDownloading() {
            return _brefnetDownloading || _rmbgDownloading;
        },

        isModelReady() {
            const proModel = getProModelForDevice();
            return proModel === 'brefnet' ? _brefnetReady : _rmbgReady;
        },

        async downloadProModel(onProgress) {
            const proModel = getProModelForDevice();
            if (proModel === 'brefnet') {
                await this.loadBREFNet(onProgress);
            } else {
                await this.loadRMBG(onProgress);
            }
        },

        async processImage(imageElement, mode = 'fast') {
            if (mode === 'pro') {
                const proModel = getProModelForDevice();
                const isReady = proModel === 'brefnet' ? _brefnetReady : _rmbgReady;

                if (isReady) {
                    try {
                        const result = proModel === 'brefnet'
                            ? await runBREFNet(imageElement)
                            : await runRMBG(imageElement);
                        return { success: true, dataUrl: result, model: proModel, mode: 'pro' };
                    } catch (e) {
                        return { success: false, needsModel: proModel, mode: 'pro', error: e.message };
                    }
                } else {
                    // Do NOT auto-trigger a download here — the caller decides when
                    // it's appropriate to start pulling the model (only after the
                    // user's first completed process). Until then, every pro
                    // request falls through to the server.
                    return { success: false, needsModel: proModel, mode: 'pro' };
                }
            } else {
                return { success: false, mode: 'fast', serverOnly: true };
            }
        },

        getStatus() {
            const proModel = getProModelForDevice();
            return {
                rvm: { ready: _rvmReady, size: MODELS.rvm.size },
                brefnet: { ready: _brefnetReady, downloading: _brefnetDownloading, size: MODELS.brefnet.size },
                rmbg: { ready: _rmbgReady, downloading: _rmbgDownloading, size: MODELS.rmbg.size },
                activeProModel: proModel,
                gpuCapable: _deviceInfo.gpuCapable
            };
        }
    };
})();

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        ClientProcessor.init();
    });
}
