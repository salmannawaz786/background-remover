/**
 * ONNX Web Worker for Background Removal
 * Runs ONNX inference off the main thread to prevent UI freezing
 * Supports: RVM, RMBG-1.4, BREFNet Lite ONNX
 */

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');

let rvmSession = null;
let rmbgSession = null;
let brefnetSession = null;
let u2netpSession = null;

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

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
            case 'runU2NetP':
                await handleRunU2NetP(data, id);
                break;
            case 'runBREFNet':
                await handleRunBREFNet(data, id);
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
    const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
    });
    if (modelType === 'rvm') rvmSession = session;
    else if (modelType === 'rmbg') rmbgSession = session;
    else if (modelType === 'brefnet') brefnetSession = session;
    else if (modelType === 'u2netp') u2netpSession = session;
    self.postMessage({ id, success: true, modelType });
}

async function handleRunU2NetP(data, id) {
    if (!u2netpSession) throw new Error('U2Net-P not loaded in worker');
    const { imageData, width, height } = data;
    const SIZE = 320;
    const MEAN = [0.485, 0.456, 0.406];
    const STD = [0.229, 0.224, 0.225];

    const input = new Float32Array(3 * SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const srcX = Math.min(width - 1, Math.floor(x * width / SIZE));
            const srcY = Math.min(height - 1, Math.floor(y * height / SIZE));
            const srcIdx = (srcY * width + srcX) * 4;
            const dstIdx = y * SIZE + x;
            input[dstIdx] = (imageData[srcIdx] / 255 - MEAN[0]) / STD[0];
            input[SIZE * SIZE + dstIdx] = (imageData[srcIdx + 1] / 255 - MEAN[1]) / STD[1];
            input[2 * SIZE * SIZE + dstIdx] = (imageData[srcIdx + 2] / 255 - MEAN[2]) / STD[2];
        }
    }

    const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const inputName = u2netpSession.inputNames[0];
    const results = await u2netpSession.run({ [inputName]: inputTensor });
    const outputName = u2netpSession.outputNames[0];
    const mask = results[outputName].data;

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] < min) min = mask[i];
        if (mask[i] > max) max = mask[i];
    }
    const range = max - min || 1;

    const alphaMask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcX = Math.min(SIZE - 1, Math.floor(x * SIZE / width));
            const srcY = Math.min(SIZE - 1, Math.floor(y * SIZE / height));
            alphaMask[y * width + x] = (mask[srcY * SIZE + srcX] - min) / range;
        }
    }
    self.postMessage({ id, alphaMask, width, height }, [alphaMask.buffer]);
}

async function handleRunRVM(data, id) {
    if (!rvmSession) throw new Error('RVM not loaded in worker');
    const { imageData, width, height, downsampleRatio } = data;
    const W = width, H = height;

    const src = new Float32Array(3 * H * W);
    for (let i = 0; i < H * W; i++) {
        src[i] = imageData[i * 4] / 255;
        src[H * W + i] = imageData[i * 4 + 1] / 255;
        src[2 * H * W + i] = imageData[i * 4 + 2] / 255;
    }

    const srcTensor = new ort.Tensor('float32', src, [1, 3, H, W]);
    const r = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
    const dsr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);

    const results = await rvmSession.run({
        src: srcTensor, r1i: r, r2i: r, r3i: r, r4i: r, downsample_ratio: dsr
    });
    const pha = results.pha.data;
    const alphaMask = new Float32Array(pha.length);
    alphaMask.set(pha);
    self.postMessage({ id, alphaMask, width, height }, [alphaMask.buffer]);
}

async function handleRunRMBG(data, id) {
    if (!rmbgSession) throw new Error('RMBG not loaded in worker');
    const { imageData, width, height } = data;
    const SIZE = 1024;

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

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] < min) min = mask[i];
        if (mask[i] > max) max = mask[i];
    }
    const range = max - min || 1;

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

async function handleRunBREFNet(data, id) {
    if (!brefnetSession) throw new Error('BREFNet not loaded in worker');
    const { imageData, width, height } = data;
    const SIZE = 512;
    const MEAN = new Float32Array([0.485, 0.456, 0.406]);
    const STD = new Float32Array([0.229, 0.224, 0.225]);

    const input = new Float32Array(3 * SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const srcX = Math.floor(x * width / SIZE);
            const srcY = Math.floor(y * height / SIZE);
            const srcIdx = (srcY * width + srcX) * 4;
            const dstIdx = y * SIZE + x;
            input[dstIdx] = (imageData[srcIdx] / 255 - MEAN[0]) / STD[0];
            input[SIZE * SIZE + dstIdx] = (imageData[srcIdx + 1] / 255 - MEAN[1]) / STD[1];
            input[2 * SIZE * SIZE + dstIdx] = (imageData[srcIdx + 2] / 255 - MEAN[2]) / STD[2];
        }
    }

    const inputTensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const results = await brefnetSession.run({ input_image: inputTensor });
    const raw = results.output_image.data;

    const alphaMask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcX = Math.floor(x * SIZE / width);
            const srcY = Math.floor(y * SIZE / height);
            const srcIdx = srcY * SIZE + srcX;
            const logit = raw[srcIdx];
            alphaMask[y * width + x] = 1 / (1 + Math.exp(-logit));
        }
    }
    self.postMessage({ id, alphaMask, width, height }, [alphaMask.buffer]);
}
