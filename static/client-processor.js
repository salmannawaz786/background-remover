// Client-side AI background removal using WebGPU + WASM fallback
// Multi-model: RMBG-1.4 (HD) + BiRefNet-lite (Best) via Transformers.js
// Smart routing: WebGPU → WASM → Server fallback
// Supports: Apple Silicon (M1-M4), NVIDIA, AMD, Intel Arc

const ClientProcessor = (() => {
    // ── State ──
    let _isCapable = false;
    let _webgpuAvailable = false;
    let _wasmFallback = false;
    let _deviceInfo = null;
    let _transformers = null;
    let _modelDtype = 'fp32';
    let _device = 'wasm'; // 'webgpu' or 'wasm'

    // Model registry: keyed by quality mode
    const _models = {
        hd:   { id: 'briaai/RMBG-1.4',      model: null, processor: null, ready: false, loading: false, promise: null, needsSigmoid: false },
        best: { id: 'briaai/RMBG-1.4',      model: null, processor: null, ready: false, loading: false, promise: null, needsSigmoid: false },
    };

    let _downloadProgress = 0;
    let _activeModelKey = null; // which model is currently loaded

    const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

    function isMobile() {
        return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    }

    // Check GPU memory (avoid crashing low-VRAM devices)
    async function checkGPUMemory() {
        try {
            if (!navigator.gpu) return false;
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;
            const device = await adapter.requestDevice({
                requiredLimits: { maxBufferSize: 256 * 1024 * 1024 }
            });
            device.destroy();
            return true;
        } catch (e) {
            return false;
        }
    }

    // Lazy-load Transformers.js
    async function loadLibrary() {
        if (_transformers) return _transformers;
        _transformers = await import(TRANSFORMERS_CDN);
        return _transformers;
    }

    // ── Post-process mask from model output ──
    async function buildMask(output, origWidth, origHeight, needsSigmoid) {
        const { RawImage } = await loadLibrary();

        let maskData = output[0];

        // Apply sigmoid if model outputs logits (BiRefNet)
        if (needsSigmoid) {
            // sigmoid in-place on the tensor
            maskData = maskData.sigmoid();
        }

        const maskTensor = maskData.mul(255).clamp(0, 255).to('uint8');
        const w = maskTensor.dims[maskTensor.dims.length - 1];
        const h = maskTensor.dims[maskTensor.dims.length - 2];
        const maskImage = new RawImage(maskTensor.data, w, h, 1);
        const resizedMask = await maskImage.resize(origWidth, origHeight);

        // Cleanup tensors
        try { maskTensor.dispose?.(); } catch {}

        return resizedMask;
    }

    return {
        get isCapable()       { return _isCapable; },
        get isModelReady()    { return _models.hd.ready || _models.best.ready; },
        get isDownloading()   { return _models.hd.loading || _models.best.loading; },
        get downloadProgress(){ return _downloadProgress; },
        get deviceInfo()      { return _deviceInfo; },
        get device()          { return _device; },

        // ── Device detection: WebGPU + GPU vendor (~50ms) ──
        async detectDevice() {
            try {
                // Mobile — always server
                if (isMobile()) {
                    _deviceInfo = { gpu: 'Mobile', capable: false, isMobile: true };
                    return false;
                }

                // Check WebGPU
                if (navigator.gpu) {
                    const adapter = await Promise.race([
                        navigator.gpu.requestAdapter(),
                        new Promise((_, rej) => setTimeout(() => rej('timeout'), 2000))
                    ]);

                    if (adapter) {
                        let info = {};
                        try { info = await adapter.requestAdapterInfo(); } catch {}

                        const vendor = (info.vendor || '').toLowerCase();
                        const arch   = (info.architecture || '').toLowerCase();
                        const desc   = (info.description || '').toLowerCase();

                        const isAppleSilicon = vendor.includes('apple') || arch.includes('apple');
                        const isNvidia = vendor.includes('nvidia') || desc.includes('nvidia') || desc.includes('geforce');
                        const isAMD    = vendor.includes('amd') || desc.includes('radeon') || desc.includes('amd');
                        const isIntel  = vendor.includes('intel') || desc.includes('intel');

                        // fp16 for Apple Silicon & NVIDIA (best perf), fp32 for AMD/Intel
                        const supportsFp16 = isAppleSilicon || isNvidia;
                        _modelDtype = supportsFp16 ? 'fp16' : 'fp32';

                        // WebGPU capable = any recognized GPU
                        const gpuCapable = isAppleSilicon || isNvidia || isAMD || isIntel;

                        if (gpuCapable) {
                            const memOk = await checkGPUMemory();
                            if (memOk) {
                                _webgpuAvailable = true;
                                _device = 'webgpu';
                                _isCapable = true;
                            }
                        }

                        const gpuName = isAppleSilicon ? 'Apple Silicon' :
                                        isNvidia ? 'NVIDIA GPU' :
                                        isAMD ? 'AMD GPU' :
                                        isIntel ? 'Intel GPU' : 'Unknown GPU';

                        _deviceInfo = {
                            isAppleSilicon, isNvidia, isAMD, isIntel,
                            gpu: info.description || info.vendor || gpuName,
                            gpuShort: gpuName,
                            capable: _isCapable,
                            dtype: _modelDtype,
                            device: _device,
                            isMobile: false
                        };

                    }
                }

                // WASM fallback for non-WebGPU desktops
                if (!_webgpuAvailable) {
                    _wasmFallback = true;
                    _device = 'wasm';
                    _isCapable = true; // WASM works everywhere
                    _modelDtype = 'q8'; // Use quantized for WASM speed
                    _deviceInfo = {
                        gpu: 'CPU (WASM)',
                        gpuShort: 'CPU',
                        capable: true,
                        dtype: 'q8',
                        device: 'wasm',
                        isMobile: false,
                        isWasm: true
                    };
                }

                return _isCapable;
            } catch (e) {
                return false;
            }
        },

        // ── Check if any model is cached ──
        async isModelCached() {
            try {
                if (!('caches' in window)) return false;
                const cache = await caches.open('transformers-cache');
                const keys = await cache.keys();
                const hasModel = keys.some(k => k.url.includes('RMBG-1.4') && k.url.includes('onnx'));
                return hasModel;
            } catch { return false; }
        },

        // ── Initialize a model by quality mode ──
        async initModel(onProgress, quality = 'hd') {
            // Normalize: 'fast' always goes to server, 'hd' and 'best' can be client-side
            const key = (quality === 'best') ? 'best' : 'hd';
            const entry = _models[key];

            if (entry.ready) return true;
            if (entry.promise) return entry.promise;

            entry.promise = (async () => {
                entry.loading = true;
                try {
                    const { AutoModel, AutoProcessor } = await loadLibrary();

                    const progressCallback = (progress) => {
                        if (progress.status === 'progress' && progress.progress) {
                            _downloadProgress = Math.round(progress.progress);
                            onProgress?.(_downloadProgress, progress.file);
                        }
                    };

                    // Load processor
                    entry.processor = await AutoProcessor.from_pretrained(entry.id, {
                        progress_callback: progressCallback
                    });

                    // Load model on best available device
                    const modelOpts = {
                        device: _device,
                        progress_callback: progressCallback
                    };

                    // dtype config based on device
                    if (_device === 'webgpu') {
                        modelOpts.dtype = _modelDtype;  // fp16 or fp32
                    } else {
                        // WASM: use quantized for speed
                        modelOpts.dtype = 'q8';
                    }

                    entry.model = await AutoModel.from_pretrained(entry.id, modelOpts);

                    entry.ready = true;
                    entry.loading = false;
                    _activeModelKey = key;
                    onProgress?.(100, 'ready');
                    return true;
                } catch (e) {
                    entry.loading = false;
                    entry.promise = null;

                    // If WebGPU failed, try WASM fallback
                    if (_device === 'webgpu') {
                        _device = 'wasm';
                        _wasmFallback = true;
                        _modelDtype = 'q8';
                        if (_deviceInfo) {
                            _deviceInfo.device = 'wasm';
                            _deviceInfo.dtype = 'q8';
                        }
                        return this.initModel(onProgress, quality);
                    }

                    _isCapable = false;
                    return false;
                }
            })();

            return entry.promise;
        },

        // ── Remove background: picks right model based on quality ──
        async removeBackground(imageSource, quality = 'hd') {
            const key = (quality === 'best') ? 'best' : 'hd';
            const entry = _models[key];

            if (!entry.ready || !entry.model || !entry.processor) {
                throw new Error(`Model not ready for ${quality} mode`);
            }

            const { RawImage } = await loadLibrary();

            let imageURL;
            if (imageSource instanceof File || imageSource instanceof Blob) {
                imageURL = URL.createObjectURL(imageSource);
            } else {
                imageURL = imageSource;
            }

            try {
                const startTime = performance.now();

                // Load and preprocess
                const image = await RawImage.fromURL(imageURL);
                const { pixel_values } = await entry.processor(image);

                // Run inference
                const { output } = await entry.model({ input: pixel_values });

                // Build mask at original resolution
                const resizedMask = await buildMask(output, image.width, image.height, entry.needsSigmoid);

                // Apply mask to original image via canvas
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');

                const imgEl = new Image();
                await new Promise((resolve, reject) => {
                    imgEl.onload = resolve;
                    imgEl.onerror = reject;
                    imgEl.src = imageURL;
                });
                ctx.drawImage(imgEl, 0, 0, image.width, image.height);

                // Apply alpha mask
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const maskData = resizedMask.data;
                for (let i = 0; i < maskData.length; i++) {
                    imageData.data[i * 4 + 3] = maskData[i];
                }
                ctx.putImageData(imageData, 0, 0);

                // Export as WebP
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.95));

                // Free GPU tensors
                try {
                    pixel_values?.dispose?.();
                    output?.[0]?.dispose?.();
                } catch {}

                return blob;
            } finally {
                if (imageSource instanceof File || imageSource instanceof Blob) {
                    URL.revokeObjectURL(imageURL);
                }
            }
        },

        // ── Smart routing: should this quality mode use server? ──
        shouldUseServer(quality = 'fast') {
            // Fast mode: always server (Silueta is tiny and fast)
            if (quality === 'fast') return true;

            // Mobile: always server
            if (isMobile()) return true;

            // Not capable at all
            if (!_isCapable) return true;

            // Check if the requested model is ready
            const key = (quality === 'best') ? 'best' : 'hd';
            if (!_models[key].ready) return true;

            return false;
        },

        // ── Check if a specific quality model is ready ──
        isQualityReady(quality) {
            if (quality === 'fast') return false; // fast = server only
            const key = (quality === 'best') ? 'best' : 'hd';
            return _models[key].ready;
        },

        // ── Upload processed image to R2 ──
        async uploadToR2(blob, filename) {
            try {
                const formData = new FormData();
                formData.append('image', blob, filename || 'processed.webp');
                const response = await fetch('/api/upload-to-r2', { method: 'POST', body: formData });
                const data = await response.json();
                return data;
            } catch (e) {
                return { success: false };
            }
        }
    };
})();
