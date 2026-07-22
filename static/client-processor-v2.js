/**
 * Client-Side Background Remover v4.0
 * ====================================
 * Smart routing:
 *   FAST mode: Person -> RVM (on-device), Object -> U2Net-P (on-device)
 *   PRO mode (Desktop / GPU-capable phones): BREFNet Lite (on-device)
 *   PRO mode (light phones): server
 *   Fallback: always server until models are downloaded
 *
 * Models auto-download in the background on page load and persist
 * forever via Cache API. Interrupted downloads resume on next visit.
 */

const ClientProcessor = (() => {
    const MODELS = {
        rvm: {
            id: 'rvm-mobilenetv3',
            url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx',
            size: 15
        },
        u2netp: {
            id: 'u2netp-onnx',
            url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
            size: 4.5
        },
        brefnet: {
            id: 'brefnet-lite-fp16',
            url: 'https://huggingface.co/salluu3432/bg-remover-models/resolve/main/model_fp16.onnx',
            size: 98
        },
        realesr: {
            id: 'realesr-x4-compact',
            url: 'https://huggingface.co/salluu3432/bg-remover-models/resolve/main/realesr_x4.onnx',
            size: 4.6
        }
    };

    const CACHE_NAME = 'bg-remover-models-v4';

    let _rvmSession = null;
    let _u2netpSession = null;
    let _brefnetSession = null;
    let _realesrSession = null;
    let _rvmReady = false;
    let _u2netpReady = false;
    let _brefnetReady = false;
    let _realesrReady = false;
    let _rvmDownloading = false;
    let _u2netpDownloading = false;
    let _brefnetDownloading = false;
    let _realesrDownloading = false;
    let _faceDetector = null;
    let _faceDetectorSupported = false;
    let _deviceInfo = { capable: true, isMobile: false };
    let _initPromise = null;
    let _autoDownloadStarted = false;

    let _worker = null;
    let _workerReady = false;
    let _workerHasRVM = false;
    let _workerHasU2NetP = false;
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
                _worker.onerror = (e) => console.warn('[Worker] Error:', e.message);
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

    // ── Model Download (with progress, cache, timeout) ──────────────────────

    async function downloadModel(modelKey, modelUrl, onProgress) {
        let arrayBuffer = await getCachedModel(modelKey);
        if (arrayBuffer) {
            if (onProgress) onProgress(1);
            return arrayBuffer;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);

        try {
            const response = await fetch(modelUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            const contentLength = +response.headers.get('Content-Length') || 0;
            const reader = response.body.getReader();
            let received = 0;
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (onProgress && contentLength) onProgress(received / contentLength);
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

    // ── Shared canvas helper ─────────────────────────────────────────────────

    function imageToCanvas(imageElement, maxDim = 0) {
        let W = imageElement.naturalWidth || imageElement.width;
        let H = imageElement.naturalHeight || imageElement.height;
        if (maxDim > 0 && Math.max(W, H) > maxDim) {
            const scale = maxDim / Math.max(W, H);
            W = Math.round(W * scale);
            H = Math.round(H * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageElement, 0, 0, W, H);
        return { canvas, ctx, W, H, imageData: ctx.getImageData(0, 0, W, H) };
    }

    // ── RVM Inference (persons) ──────────────────────────────────────────────

    async function runRVM(imageElement) {
        const { canvas, ctx, W, H, imageData } = imageToCanvas(imageElement);
        const data = imageData.data;
        const downsampleRatio = Math.min(1.0, 512 / Math.max(H, W));

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
            data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alphaMask[i])) * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── U2Net-P Inference (objects) ──────────────────────────────────────────

    async function runU2NetP(imageElement) {
        const { canvas, ctx, W, H, imageData } = imageToCanvas(imageElement);
        const data = imageData.data;

        let alphaMask;
        if (_workerReady && _worker && _workerHasU2NetP) {
            try {
                const result = await postToWorker('runU2NetP', { imageData: data, width: W, height: H });
                alphaMask = result.alphaMask;
            } catch (e) { alphaMask = null; }
        }

        if (!alphaMask) {
            if (!_u2netpSession) throw new Error('U2Net-P not available');
            const SIZE = 320;
            const MEAN = [0.485, 0.456, 0.406];
            const STD = [0.229, 0.224, 0.225];

            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = SIZE; resizeCanvas.height = SIZE;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(imageElement, 0, 0, SIZE, SIZE);
            const pixels = resizeCtx.getImageData(0, 0, SIZE, SIZE).data;

            const input = new Float32Array(3 * SIZE * SIZE);
            for (let i = 0; i < SIZE * SIZE; i++) {
                input[i] = (pixels[i * 4] / 255 - MEAN[0]) / STD[0];
                input[SIZE * SIZE + i] = (pixels[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
                input[2 * SIZE * SIZE + i] = (pixels[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
            }

            const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
            const inputName = _u2netpSession.inputNames[0];
            const results = await _u2netpSession.run({ [inputName]: inputTensor });
            const outputName = _u2netpSession.outputNames[0];
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
                    const srcX = Math.min(SIZE - 1, Math.floor(x * SIZE / W));
                    const srcY = Math.min(SIZE - 1, Math.floor(y * SIZE / H));
                    alphaMask[y * W + x] = (mask[srcY * SIZE + srcX] - min) / range;
                }
            }
        }

        for (let i = 0; i < W * H; i++) {
            data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alphaMask[i])) * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── BREFNet Inference (pro) ──────────────────────────────────────────────

    async function runBREFNet(imageElement) {
        const { canvas, ctx, W, H, imageData } = imageToCanvas(imageElement);
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
            const pixels = resizeCtx.getImageData(0, 0, SIZE, SIZE).data;

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
                    const srcX = Math.min(SIZE - 1, Math.floor(x * SIZE / W));
                    const srcY = Math.min(SIZE - 1, Math.floor(y * SIZE / H));
                    const logit = raw[srcY * SIZE + srcX];
                    alphaMask[y * W + x] = 1 / (1 + Math.exp(-logit));
                }
            }
        }

        for (let i = 0; i < W * H; i++) {
            data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alphaMask[i])) * 255);
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }

    // ── Real-ESRGAN x4 Upscale (on demand) ─────────────────────────────────

    async function runUpscale(imageElement) {
        if (!_realesrSession) throw new Error('Real-ESRGAN not loaded');
        const MAX_IN = 256;
        let W = imageElement.naturalWidth || imageElement.width;
        let H = imageElement.naturalHeight || imageElement.height;
        const scale = Math.min(MAX_IN / Math.max(W, H), 1.0);
        const tw = Math.max(1, Math.round(W * scale));
        const th = Math.max(1, Math.round(H * scale));

        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = tw; resizeCanvas.height = th;
        const resizeCtx = resizeCanvas.getContext('2d');
        resizeCtx.drawImage(imageElement, 0, 0, tw, th);
        const pixels = resizeCtx.getImageData(0, 0, tw, th).data;

        const input = new Float32Array(3 * tw * th);
        for (let i = 0; i < tw * th; i++) {
            input[i] = pixels[i * 4] / 255;
            input[tw * th + i] = pixels[i * 4 + 1] / 255;
            input[2 * tw * th + i] = pixels[i * 4 + 2] / 255;
        }

        const inputTensor = new ort.Tensor('float32', input, [1, 3, th, tw]);
        const inputName = _realesrSession.inputNames[0];
        const results = await _realesrSession.run({ [inputName]: inputTensor });
        const outData = results[_realesrSession.outputNames[0]].data;

        const outW = tw * 4, outH = th * 4;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW; outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        const outImage = outCtx.createImageData(outW, outH);
        const planeSize = outW * outH;
        for (let i = 0; i < planeSize; i++) {
            outImage.data[i * 4]     = Math.min(255, Math.max(0, Math.round(outData[i] * 255)));
            outImage.data[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(outData[planeSize + i] * 255)));
            outImage.data[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(outData[2 * planeSize + i] * 255)));
            outImage.data[i * 4 + 3] = 255;
        }
        outCtx.putImageData(outImage, 0, 0);
        return outCanvas.toDataURL('image/png');
    }

    // ── Device Detection ─────────────────────────────────────────────────────

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

    // 'brefnet' = download pro model on device | 'server' = always use server for pro
    function getProModelForDevice() {
        if (!isMobile()) return 'brefnet';            // Desktop: on-device BREFNet
        return detectGPUCapability() ? 'brefnet' : 'server'; // Flagship phones: on-device; light phones: server
    }

    // ── Model Loaders ────────────────────────────────────────────────────────

    async function loadModelGeneric(modelType, modelCfg, setReady, workerFlag) {
        const modelBuffer = await downloadModel(modelCfg.id, modelCfg.url, null);
        if (_workerReady && _worker) {
            try {
                await postToWorker('loadModel', { modelType, modelBuffer: modelBuffer.slice(0) });
                if (modelType === 'rvm') _workerHasRVM = true;
                else if (modelType === 'u2netp') _workerHasU2NetP = true;
                else if (modelType === 'brefnet') _workerHasBREFNet = true;
                setReady(true);
                return;
            } catch (e) {
                console.warn(`[ClientAI] Worker ${modelType} load failed, using main thread:`, e.message);
            }
        }
        const session = await createONNXSession(modelBuffer);
        if (modelType === 'rvm') _rvmSession = session;
        else if (modelType === 'u2netp') _u2netpSession = session;
        else if (modelType === 'brefnet') _brefnetSession = session;
        setReady(true);
    }

    // ── Public API ───────────────────────────────────────────────────────────

    return {
        get isRVMReady() { return _rvmReady; },
        get isU2NetPReady() { return _u2netpReady; },
        get isBREFNetReady() { return _brefnetReady; },
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

                // Auto-start background downloads (resumes if interrupted)
                this._startAutoDownload();
            })();
            return _initPromise;
        },

        // Downloads run in background; Cache API persists them forever.
        // If the tab closed mid-download, this restarts on next visit.
        async _startAutoDownload() {
            if (_autoDownloadStarted) return;
            _autoDownloadStarted = true;
            try {
                // Fast models first (small): RVM for persons, U2Net-P for objects
                if (!_rvmReady) {
                    _rvmDownloading = true;
                    loadModelGeneric('rvm', MODELS.rvm, (v) => { _rvmReady = v; })
                        .catch((e) => console.warn('[ClientAI] RVM download failed:', e.message))
                        .finally(() => { _rvmDownloading = false; });
                }
                if (!_u2netpReady) {
                    _u2netpDownloading = true;
                    loadModelGeneric('u2netp', MODELS.u2netp, (v) => { _u2netpReady = v; })
                        .catch((e) => console.warn('[ClientAI] U2Net-P download failed:', e.message))
                        .finally(() => { _u2netpDownloading = false; });
                }
                // Pro model only for capable devices (desktop / flagship phones)
                if (getProModelForDevice() === 'brefnet' && !_brefnetReady) {
                    _brefnetDownloading = true;
                    loadModelGeneric('brefnet', MODELS.brefnet, (v) => { _brefnetReady = v; })
                        .catch((e) => console.warn('[ClientAI] BREFNet download failed:', e.message))
                        .finally(() => { _brefnetDownloading = false; });
                }
            } catch (e) { /* ignore */ }
        },

        isModelDownloading() {
            return _brefnetDownloading || _rvmDownloading || _u2netpDownloading;
        },

        // Fast models (RVM person + U2Net-P object) ready = can process fast mode on device
        isFastModelReady() {
            return _rvmReady || _u2netpReady;
        },

        // Pro model ready (only on capable devices)
        isModelReady() {
            return getProModelForDevice() === 'brefnet' && _brefnetReady;
        },

        // ── Real-ESRGAN upscaler (downloaded on demand only) ──
        isUpscaleReady() { return _realesrReady; },
        isUpscaleDownloading() { return _realesrDownloading; },

        async loadUpscaleModel(onProgress) {
            if (_realesrReady) return;
            if (_realesrDownloading) {
                // Wait for ongoing download
                while (_realesrDownloading) await new Promise(r => setTimeout(r, 500));
                return;
            }
            _realesrDownloading = true;
            try {
                const modelBuffer = await downloadModel(MODELS.realesr.id, MODELS.realesr.url, onProgress);
                _realesrSession = await createONNXSession(modelBuffer);
                _realesrReady = true;
            } catch (e) {
                console.error('[ClientAI] Real-ESRGAN load FAILED:', e.message);
                _realesrReady = false;
                throw e;
            } finally {
                _realesrDownloading = false;
            }
        },

        async upscaleImage(imageElement) {
            if (!_realesrReady) throw new Error('upscale_model_not_ready');
            return await runUpscale(imageElement);
        },

        // Kept for backwards-compat with editor page
        async downloadProModel(onProgress) {
            if (getProModelForDevice() !== 'brefnet') return;
            if (_brefnetReady || _brefnetDownloading) return;
            _brefnetDownloading = true;
            try {
                const modelBuffer = await downloadModel(MODELS.brefnet.id, MODELS.brefnet.url, onProgress);
                if (_workerReady && _worker) {
                    try {
                        await postToWorker('loadModel', { modelType: 'brefnet', modelBuffer: modelBuffer.slice(0) });
                        _workerHasBREFNet = true;
                        _brefnetReady = true;
                        return;
                    } catch (e) { /* fall to main thread */ }
                }
                _brefnetSession = await createONNXSession(modelBuffer);
                _brefnetReady = true;
            } finally {
                _brefnetDownloading = false;
            }
        },

        async processImage(imageElement, mode = 'fast') {
            if (mode === 'pro') {
                if (getProModelForDevice() !== 'brefnet') {
                    return { success: false, mode: 'pro', serverOnly: true };
                }
                if (_brefnetReady) {
                    try {
                        const result = await runBREFNet(imageElement);
                        return { success: true, dataUrl: result, model: 'brefnet', mode: 'pro' };
                    } catch (e) {
                        return { success: false, needsModel: 'brefnet', mode: 'pro', error: e.message };
                    }
                }
                return { success: false, needsModel: 'brefnet', mode: 'pro' };
            }

            // FAST mode: person -> RVM, object -> U2Net-P (on-device when ready)
            try {
                const person = await detectPerson(imageElement);
                if (person && _rvmReady) {
                    const result = await runRVM(imageElement);
                    return { success: true, dataUrl: result, model: 'rvm', mode: 'fast' };
                }
                if (!person && _u2netpReady) {
                    const result = await runU2NetP(imageElement);
                    return { success: true, dataUrl: result, model: 'u2netp', mode: 'fast' };
                }
                return { success: false, mode: 'fast', serverOnly: true, reason: person ? 'rvm_not_ready' : 'u2netp_not_ready' };
            } catch (e) {
                return { success: false, mode: 'fast', serverOnly: true, error: e.message };
            }
        },

        getStatus() {
            const proModel = getProModelForDevice();
            return {
                rvm: { ready: _rvmReady, downloading: _rvmDownloading, size: MODELS.rvm.size },
                u2netp: { ready: _u2netpReady, downloading: _u2netpDownloading, size: MODELS.u2netp.size },
                brefnet: { ready: _brefnetReady, downloading: _brefnetDownloading, size: MODELS.brefnet.size },
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
