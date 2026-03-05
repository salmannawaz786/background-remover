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
ort.env.wasm.numThreads = 1;

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
    
    // Calculate downsampled size
    const dW = Math.round(width * downsampleRatio);
    const dH = Math.round(height * downsampleRatio);
    
    // Prepare input tensor (1, 3, H, W)
    const input = new Float32Array(3 * dH * dW);
    
    // Downsample and normalize
    for (let y = 0; y < dH; y++) {
        for (let x = 0; x < dW; x++) {
            const srcX = Math.floor(x / downsampleRatio);
            const srcY = Math.floor(y / downsampleRatio);
            const srcIdx = (srcY * width + srcX) * 4;
            const dstIdx = y * dW + x;
            
            input[dstIdx] = imageData[srcIdx] / 255;
            input[dH * dW + dstIdx] = imageData[srcIdx + 1] / 255;
            input[2 * dH * dW + dstIdx] = imageData[srcIdx + 2] / 255;
        }
    }
    
    const inputTensor = new ort.Tensor('float32', input, [1, 3, dH, dW]);
    const r1 = new ort.Tensor('float32', new Float32Array(1 * 1 * 1 * 1).fill(0), [1, 1, 1, 1]);
    const r2 = new ort.Tensor('float32', new Float32Array(1 * 1 * 1 * 1).fill(0), [1, 1, 1, 1]);
    const r3 = new ort.Tensor('float32', new Float32Array(1 * 1 * 1 * 1).fill(0), [1, 1, 1, 1]);
    const r4 = new ort.Tensor('float32', new Float32Array(1 * 1 * 1 * 1).fill(0), [1, 1, 1, 1]);
    const downsample = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);
    
    const feeds = {
        src: inputTensor,
        r1i: r1, r2i: r2, r3i: r3, r4i: r4,
        downsample_ratio: downsample
    };
    
    const results = await rvmSession.run(feeds);
    const pha = results.pha.data;
    
    // Create alpha mask at original resolution
    const alphaMask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcX = Math.floor(x * downsampleRatio * dW / width);
            const srcY = Math.floor(y * downsampleRatio * dH / height);
            const srcIdx = Math.min(srcY, dH - 1) * dW + Math.min(srcX, dW - 1);
            alphaMask[y * width + x] = pha[srcIdx];
        }
    }
    
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
