// Client-side AI background removal using WebGPU
// Activates only for: Apple Silicon (M1-M5) and NVIDIA GPUs
// Falls back to server processing for all other devices

const ClientProcessor = (() => {
    // State
    let _isCapable = false;
    let _isModelReady = false;
    let _isDownloading = false;
    let _downloadProgress = 0;
    let _model = null;
    let _processor = null;
    let _deviceInfo = null;
    let _transformers = null;
    let _initPromise = null;

    const MODEL_ID = 'briaai/RMBG-2.0';
    const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

    // Load transformers.js library lazily
    async function loadLibrary() {
        if (_transformers) return _transformers;
        _transformers = await import(TRANSFORMERS_CDN);
        return _transformers;
    }

    return {
        get isCapable() { return _isCapable; },
        get isModelReady() { return _isModelReady; },
        get isDownloading() { return _isDownloading; },
        get downloadProgress() { return _downloadProgress; },
        get deviceInfo() { return _deviceInfo; },

        // Fast device detection — checks WebGPU + GPU vendor (< 100ms)
        async detectDevice() {
            try {
                if (!navigator.gpu) {
                    console.log('[ClientAI] No WebGPU support');
                    return false;
                }

                const adapter = await Promise.race([
                    navigator.gpu.requestAdapter(),
                    new Promise((_, reject) => setTimeout(() => reject('timeout'), 2000))
                ]);

                if (!adapter) {
                    console.log('[ClientAI] No WebGPU adapter');
                    return false;
                }

                let info;
                try {
                    info = await adapter.requestAdapterInfo();
                } catch {
                    info = {};
                }

                const vendor = (info.vendor || '').toLowerCase();
                const arch = (info.architecture || '').toLowerCase();
                const desc = (info.description || '').toLowerCase();

                const isAppleSilicon = vendor.includes('apple') || arch.includes('apple');
                const isNvidia = vendor.includes('nvidia') || desc.includes('nvidia') || desc.includes('geforce');

                _deviceInfo = {
                    isAppleSilicon,
                    isNvidia,
                    gpu: info.description || info.vendor || 'Unknown GPU',
                    capable: isAppleSilicon || isNvidia
                };

                _isCapable = _deviceInfo.capable;
                console.log(`[ClientAI] Device: ${_deviceInfo.gpu} | Apple Silicon: ${isAppleSilicon} | NVIDIA: ${isNvidia} | Capable: ${_isCapable}`);
                return _isCapable;
            } catch (e) {
                console.log('[ClientAI] Detection failed:', e);
                return false;
            }
        },

        // Check if model is already cached in browser (< 50ms)
        async isModelCached() {
            try {
                if (!('caches' in window)) return false;
                const cache = await caches.open('transformers-cache');
                const keys = await cache.keys();
                const hasModel = keys.some(k => k.url.includes('RMBG-2.0') && k.url.includes('onnx'));
                console.log(`[ClientAI] Model cached: ${hasModel} (${keys.length} cache entries)`);
                return hasModel;
            } catch {
                return false;
            }
        },

        // Initialize model — downloads if needed, loads from cache if available
        async initModel(onProgress) {
            if (_isModelReady) return true;
            if (_initPromise) return _initPromise;

            _initPromise = (async () => {
                _isDownloading = true;

                try {
                    const { AutoModel, AutoProcessor } = await loadLibrary();

                    const progressCallback = (progress) => {
                        if (progress.status === 'progress' && progress.progress) {
                            _downloadProgress = Math.round(progress.progress);
                            onProgress?.(_downloadProgress, progress.file);
                        }
                    };

                    console.log('[ClientAI] Loading processor...');
                    _processor = await AutoProcessor.from_pretrained(MODEL_ID, {
                        progress_callback: progressCallback
                    });

                    console.log('[ClientAI] Loading model (WebGPU)...');
                    _model = await AutoModel.from_pretrained(MODEL_ID, {
                        device: 'webgpu',
                        dtype: 'fp32',
                        progress_callback: progressCallback
                    });

                    _isModelReady = true;
                    _isDownloading = false;
                    console.log('[ClientAI] Model ready!');
                    onProgress?.(100, 'ready');
                    return true;
                } catch (e) {
                    console.error('[ClientAI] Model init failed:', e);
                    _isDownloading = false;
                    _isCapable = false;
                    _initPromise = null;
                    return false;
                }
            })();

            return _initPromise;
        },

        // Remove background client-side using WebGPU
        async removeBackground(imageSource) {
            if (!_isModelReady || !_model || !_processor) {
                throw new Error('Model not ready');
            }

            const { RawImage } = await loadLibrary();

            // Load image from File, Blob, or URL
            let imageURL;
            if (imageSource instanceof File || imageSource instanceof Blob) {
                imageURL = URL.createObjectURL(imageSource);
            } else {
                imageURL = imageSource;
            }

            try {
                console.log('[ClientAI] Processing image...');
                const startTime = performance.now();

                // Load and preprocess
                const image = await RawImage.fromURL(imageURL);
                const { pixel_values } = await _processor(image);

                // Run inference on WebGPU
                const { output } = await _model({ input: pixel_values });

                // Post-process: create mask at original resolution
                const maskTensor = output[0].mul(255).to('uint8');
                const maskImage = new RawImage(
                    maskTensor.data,
                    maskTensor.dims[maskTensor.dims.length - 1],
                    maskTensor.dims[maskTensor.dims.length - 2],
                    1
                );
                const resizedMask = await maskImage.resize(image.width, image.height);

                // Apply mask to original image on canvas
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const ctx = canvas.getContext('2d');

                // Draw original image
                const imgEl = new Image();
                await new Promise((resolve, reject) => {
                    imgEl.onload = resolve;
                    imgEl.onerror = reject;
                    imgEl.src = imageURL;
                });
                ctx.drawImage(imgEl, 0, 0, image.width, image.height);

                // Apply mask as alpha channel
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const maskData = resizedMask.data;
                for (let i = 0; i < maskData.length; i++) {
                    imageData.data[i * 4 + 3] = maskData[i];
                }
                ctx.putImageData(imageData, 0, 0);

                // Export as WebP blob
                const blob = await new Promise((resolve) => {
                    canvas.toBlob(resolve, 'image/webp', 0.95);
                });

                const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
                console.log(`[ClientAI] Processed in ${elapsed}s, output: ${(blob.size / 1024).toFixed(0)}KB`);

                return blob;
            } finally {
                if (imageSource instanceof File || imageSource instanceof Blob) {
                    URL.revokeObjectURL(imageURL);
                }
            }
        },

        // Upload client-processed image to R2 via server (no processing needed server-side)
        async uploadToR2(blob, filename) {
            try {
                const formData = new FormData();
                formData.append('image', blob, filename || 'processed.webp');

                const response = await fetch('/api/upload-to-r2', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (data.success) {
                    console.log('[ClientAI] R2 upload success:', data.key);
                }
                return data;
            } catch (e) {
                console.error('[ClientAI] R2 upload failed:', e);
                return { success: false };
            }
        }
    };
})();
