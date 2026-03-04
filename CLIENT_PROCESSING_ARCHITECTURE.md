# Client-Side Processing Architecture

## How Models Download

### Source: Hugging Face (NOT your server)
Models download directly from Hugging Face to user's browser:

```javascript
// RVM (15MB) - for persons
url: 'https://huggingface.co/eafish/web-onnx/resolve/main/rvm_mobilenetv3_fp32.onnx'

// RMBG (40MB) - for objects  
url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx'
```

### Download Flow
1. **First visit**: RVM downloads automatically (15MB)
2. **First object detected**: RMBG downloads (40MB)
3. **Models cached** in browser's Cache API (permanent storage)
4. **No server bandwidth used** for model downloads

## Processing Flow

### Client-Side (Browser)
```
User Upload → Face Detection → Route to Model → ONNX Runtime → Result
```

### Server Fallback
```
Client-Side Fails → Server Processing → Return Result → Upload to R2
```

## User Device Resources

### ✅ Yes, uses user device resources:
- **CPU**: ONNX Runtime runs on user's CPU
- **Memory**: Models loaded in browser memory (55MB total)
- **Storage**: Models cached in browser Cache API
- **GPU**: WebGPU support (if available, optional)

### Performance
- **RVM**: 2-5 seconds on client vs 2-5 seconds on server
- **RMBG**: 7-10 seconds on client vs 7-10 seconds on server
- **No network latency** after models downloaded

## Cloud Upload (R2) - YES!

### Even with client-side processing, images go to cloud:

```javascript
// In server.py - always uploads to R2
if s3_client and R2_BUCKET_NAME:
    def r2_upload_background(img_bytes, r2_key):
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=r2_key,
            Body=img_bytes,
            ContentType=mimetype
        )
```

### Upload Flow
1. **Client processes image** (if models ready)
2. **Client sends result to server** (for upload)
3. **Server uploads to R2** (cloud storage)
4. **User gets R2 URL** (permanent link)

## Benefits

### For Users
- **Privacy**: Images processed locally (no upload needed initially)
- **Speed**: No network latency after models downloaded
- **Offline**: Works without internet after first download

### For You (Server Owner)
- **Less server load**: Client does the heavy lifting
- **Lower bandwidth**: Models from Hugging Face, not your server
- **Still get cloud storage**: All results uploaded to R2

## Model Storage

### Browser Cache API
- **Persistent**: Models stay until user clears browser data
- **Fast**: Direct access, no IndexedDB lag
- **Large**: Can store 55MB of models easily

### Fallback Logic
```javascript
// Try client-side first
if (ClientProcessor.isModelReady) {
    result = await ClientProcessor.processImage(image);
} else {
    // Fallback to server
    result = await fetch('/upload', { method: 'POST', body: formData });
}
```

## Summary

| Question | Answer |
|----------|--------|
| **Models download from?** | Hugging Face (direct to browser) |
| **Uses user device?** | Yes - CPU, memory, storage |
| **Images go to cloud?** | Yes - always uploaded to R2 |
| **Server bandwidth used?** | Minimal - only for API calls, not models |
| **Privacy?** | High - processing happens locally |

---

**Your users get fast, private processing AND you get cloud storage!** 🚀
