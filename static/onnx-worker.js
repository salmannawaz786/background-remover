/**
 * ONNX Web Worker for Background Removal
 * Runs ONNX inference off the main thread to prevent UI freezing
 */

// Import ONNX Runtime
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');

// Model sessions
let rvmSession = null;
let rmbgSession = null;

// Configure ONNX Runtime for worker
// CRITICAL: must set wasmPaths so the worker can find .wasm files
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

// Handle messages from main thread
self.onmessage = async function(e) {
    const { type, data, id } = e.data;
    
    try {
        switch (type) {
            case 'loadModel':
                await handleLoadModel(data, id);
                break;
            case 'runRVM':
                await handleRunRVM(data, id);
                break;
            case 'runRMBG':
                await handleRunRMBG(data, id);
                break;
            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        self.postMessage({ id, error: error.message });
    }
};

async function handleLoadModel(data, id) {
    const { modelType, modelBuffer } = data;
    
    try {
        const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        
        if (modelType === 'rvm') {
            rvmSession = session;
        } else if (modelType === 'rmbg') {
            rmbgSession = session;
        }
        
        self.postMessage({ id, success: true, modelType });
    } catch (error) {
        self.postMessage({ id, error: error.message });
    }
}

async function handleRunRVM(data, id) {
    if (!rvmSession) {
        throw new Error('RVM not loaded in worker');
    }
    
    const { imageData, width, height, downsampleRatio } = data;
    const W = width;
    const H = height;
    
    // Prepare input tensor at FULL resolution (1, 3, H, W)
    // Let the model handle downsampling via downsample_ratio parameter
    const src = new Float32Array(3 * H * W);
    for (let i = 0; i < H * W; i++) {
        src[i] = imageData[i * 4] / 255;
        src[H * W + i] = imageData[i * 4 + 1] / 255;
        src[2 * H * W + i] = imageData[i * 4 + 2] / 255;
    }
    
    const srcTensor = new ort.Tensor('float32', src, [1, 3, H, W]);
    const r = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
    const dsr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);
    
    const feeds = {
        src: srcTensor,
        r1i: r, r2i: r, r3i: r, r4i: r,
        downsample_ratio: dsr
    };
    
    const results = await rvmSession.run(feeds);
    const pha = results.pha.data;
    
    // Output alpha is already at original resolution
    const alphaMask = new Float32Array(pha.length);
    alphaMask.set(pha);
    
    self.postMessage({ id, alphaMask, width, height }, [alphaMask.buffer]);
}

async function handleRunRMBG(data, id) {
    if (!rmbgSession) {
        throw new Error('RMBG not loaded in worker');
    }
    
    const { imageData, width, height } = data;
    const SIZE = 1024;
    
    // Prepare input tensor (1, 3, 1024, 1024) - resize and normalize
    const input = new Float32Array(3 * SIZE * SIZE);
    
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const srcX = Math.floor(x * width / SIZE);
            const srcY = Math.floor(y * height / SIZE);
            const srcIdx = (srcY * width + srcX) * 4;
            const dstIdx = y * SIZE + x;
            
            input[dstIdx] = imageData[srcIdx] / 255 - 0.5;
            input[SIZE * SIZE + dstIdx] = imageData[srcIdx + 1] / 255 - 0.5;
            input[2 * SIZE * SIZE + dstIdx] = imageData[srcIdx + 2] / 255 - 0.5;
        }
    }
    
    const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const inputName = rmbgSession.inputNames[0];
    
    const results = await rmbgSession.run({ [inputName]: inputTensor });
    
    const outputName = rmbgSession.outputNames[0];
    const mask = results[outputName].data;
    
    // Normalize mask
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] < min) min = mask[i];
        if (mask[i] > max) max = mask[i];
    }
    const range = max - min || 1;
    
    // Create alpha mask at original resolution
    const alphaMask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcX = Math.floor(x * SIZE / width);
            const srcY = Math.floor(y * SIZE / height);
            const srcIdx = srcY * SIZE + srcX;
            alphaMask[y * width + x] = (mask[srcIdx] - min) / range;
        }
    }
    
    self.postMessage({ id, alphaMask, width, height }, [alphaMask.buffer]);
}
