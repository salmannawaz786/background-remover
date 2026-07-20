# System Architecture - Background Remover with Queue System

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS / FRONTEND                         │
│                     (Vercel - Next.js App)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORACLE CLOUD SERVER                           │
│                   (24GB RAM / 4 vCPUs)                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                NGINX REVERSE PROXY                      │    │
│  │  • Rate Limiting (10 uploads/min, 30 API/min)          │    │
│  │  • SSL/TLS Termination                                  │    │
│  │  • Gzip Compression                                     │    │
│  │  • Connection Pooling                                   │    │
│  └───────────────────────┬────────────────────────────────┘    │
│                          │                                       │
│  ┌────────────────────────────────────────────────────────┐    │
│  │         GUNICORN WSGI SERVER (4 workers)               │    │
│  │                                                          │    │
│  │  ┌────────────────────────────────────────────────┐   │    │
│  │  │           FLASK APPLICATION                     │   │    │
│  │  │  • Authentication (Firebase)                    │   │    │
│  │  │  • Request validation                           │   │    │
│  │  │  • File upload handling                         │   │    │
│  │  │  • Queue job submission                         │   │    │
│  │  └────────────────┬───────────────────────────────┘   │    │
│  └────────────────────┼───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────▼───────────────────────────────────┐    │
│  │              SMART QUEUE MANAGER                       │    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│    │
│  │  │  BG FAST     │  │  BG PRO      │  │  OBJ REMOVE  ││    │
│  │  │  QUEUE       │  │  QUEUE       │  │  QUEUE       ││    │
│  │  │              │  │              │  │              ││    │
│  │  │ Capacity: 3  │  │ Capacity: 2  │  │ Capacity: 1  ││    │
│  │  │ ~500MB each  │  │ ~2GB each    │  │ ~3GB each    ││    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘│    │
│  │         │                 │                 │         │    │
│  └─────────┼─────────────────┼─────────────────┼─────────┘    │
│            │                 │                 │               │
│  ┌─────────▼─────────────────▼─────────────────▼─────────┐    │
│  │              WORKER THREADS                            │    │
│  │                                                          │    │
│  │  Worker 1 ─┐  Worker 4 ─┐  Worker 6 ─┐               │    │
│  │  Worker 2  ├─ Fast       │             │               │    │
│  │  Worker 3 ─┘  Worker 5 ─┴─ Pro    Obj Remove          │    │
│  │                                                          │    │
│  │  • Memory monitoring                                    │    │
│  │  • Automatic throttling                                 │    │
│  │  • Job timeout handling                                 │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────▼───────────────────────────────────┐    │
│  │              MODEL MANAGER                             │    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│    │
│  │  │  RVM         │  │  U2Net-P     │  │  BiRefNet    ││    │
│  │  │  (15MB)      │  │  (4MB)       │  │  (98MB)      ││    │
│  │  │  Persons     │  │  Objects     │  │  Pro Quality ││    │
│  │  │  512px       │  │  320px       │  │  512px       ││    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘│    │
│  │                                                          │    │
│  │  • Person detection (Haar Cascades)                    │    │
│  │  • Model selection logic                               │    │
│  │  • ONNX inference                                      │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌────────────────┐            ┌────────────────┐
│  CLOUDFLARE R2 │            │   RESPONSE     │
│  Image Storage │            │   to User      │
│  (Background)  │            │                │
└────────────────┘            └────────────────┘
```

## 🔄 Request Flow

### 1. User Uploads Image

```
User → Frontend (Vercel) → POST /upload
                            ↓
Headers: Authorization: Bearer <firebase_token>
Body: image_file, model (fast/pro), format (webp/png)
```

### 2. Authentication & Validation

```
Nginx (rate limit) → Gunicorn → Flask
                                  ↓
                       ┌──────────┴──────────┐
                       │                     │
                  Authenticated?      File valid?
                       ↓                     ↓
                 Firebase verify       Size, type check
                       ↓                     ↓
                     Pass                  Pass
                       └──────────┬──────────┘
                                  ↓
                            Save to temp
```

### 3. Queue Submission

```
Flask → Queue Manager
        ↓
   Job Type Selection:
   • model='fast' + person detected → BG_FAST (RVM)
   • model='fast' + object detected → BG_FAST (U2Net-P)
   • model='pro' → BG_PRO (BiRefNet)
        ↓
   Check Queue Status:
   • Memory < 85% ? → Accept
   • Memory > 85% ? → Reject (503)
   • Queue full?   → Reject (503)
        ↓
   Submit Job → Get Job ID → Wait for completion
```

### 4. Worker Processing

```
Worker Thread:
  1. Acquire semaphore (wait if lane full)
  2. Check memory again
  3. Load image from disk
  4. Resize if needed (max 1500px)
  5. Run model inference:
     • RVM: 512x512, ~1-2s
     • U2Net-P: 320x320, ~1-2s
     • BiRefNet: 512x512, ~3-5s
  6. Post-process mask (refine edges)
  7. Save to BytesIO (WebP or PNG)
  8. Release semaphore
  9. Return result
```

### 5. Response & Background Upload

```
Worker completes → Flask receives result
                   ↓
              ┌────┴────┐
              │         │
         Response    Background Thread
         to User     Upload to R2
              ↓         ↓
         Image      S3 put_object
         (WebP)         ↓
              ↓      CDN URL
         Headers:       ↓
         X-Processing-Time    (logged)
         X-Queue-Wait-Time
```

## 🧠 Queue Manager Internals

### Data Structures

```python
SmartQueueManager:
  ├─ queues: {JobType → deque[Job]}
  │   ├─ BG_FAST → deque()
  │   ├─ BG_PRO → deque()
  │   └─ OBJ_REMOVE → deque()
  │
  ├─ semaphores: {JobType → Semaphore}
  │   ├─ BG_FAST → Semaphore(3)
  │   ├─ BG_PRO → Semaphore(2)
  │   └─ OBJ_REMOVE → Semaphore(1)
  │
  ├─ active_workers: {JobType → int}
  │   ├─ BG_FAST → 0-3
  │   ├─ BG_PRO → 0-2
  │   └─ OBJ_REMOVE → 0-1
  │
  └─ jobs: {job_id → Job}
      └─ Job:
          ├─ job_id
          ├─ job_type
          ├─ status (queued/processing/completed/failed)
          ├─ queued_at, started_at, completed_at
          ├─ result
          ├─ error
          └─ event (for waiting)
```

### Worker Thread Lifecycle

```
Worker Thread Start:
  ↓
while not shutdown:
  ↓
Check queue for jobs
  ├─ Job available? → Yes
  │   ↓
  │ Acquire semaphore (with timeout)
  │   ├─ Acquired → Process job
  │   │   ↓
  │   │ Check memory
  │   │   ├─ OK → Execute task
  │   │   │   ↓
  │   │   │ Mark COMPLETED
  │   │   │   ↓
  │   │   │ Trigger event
  │   │   │   ↓
  │   │   │ Release semaphore
  │   │   │
  │   │   └─ CRITICAL → Mark FAILED
  │   │       ↓
  │   │     Trigger event
  │   │       ↓
  │   │     Release semaphore
  │   │
  │   └─ Timeout → Mark TIMEOUT
  │       ↓
  │     Trigger event
  │
  └─ No job → Sleep 0.1s
```

## 💾 Memory Management

```
Total RAM: 24GB
├─ System/OS: ~2GB
├─ Docker overhead: ~1GB
├─ Available for app: ~21GB
│
└─ Allocation Strategy:
    ├─ BG Fast (3 workers): 3 × 500MB = 1.5GB
    ├─ BG Pro (2 workers): 2 × 2GB = 4GB
    ├─ Obj Remove (1 worker): 1 × 3GB = 3GB
    ├─ Models in memory: ~200MB (shared)
    ├─ Gunicorn workers: 4 × 100MB = 400MB
    ├─ Buffer/Cache: ~2GB
    └─ Free for OS/spikes: ~10GB

Memory Thresholds:
├─ < 75%: Healthy (accept all jobs)
├─ 75-85%: Warning (accept but log)
├─ > 85%: Critical (reject new jobs, run GC)
└─ > 90%: Emergency (force GC, clear caches)
```

## 🚦 Rate Limiting Strategy

### Nginx Level
```
Upload endpoint: 10 requests/min per IP
├─ Burst: 5 additional
└─ Delay: no delay (nodelay)

API endpoints: 30 requests/min per IP
├─ Burst: 10 additional
└─ Delay: no delay (nodelay)
```

### Application Level
```
Non-authenticated users:
├─ Max file size: 5MB
├─ Daily limit: 5 images/day
└─ Rate: limited by Nginx

Authenticated users:
├─ Max file size: 10MB
├─ Daily limit: unlimited
└─ Rate: limited by queue capacity
```

### Queue Level
```
Max queue size: 50 jobs per type
├─ BG Fast queue: 50 jobs max
├─ BG Pro queue: 50 jobs max
└─ Obj Remove queue: 50 jobs max

Job timeout: 60 seconds
├─ Fast jobs: typically 1-2s + 5-10s wait
├─ Pro jobs: typically 3-5s + 15-30s wait
└─ After timeout: job marked as TIMEOUT
```

## 📊 Monitoring & Observability

### Endpoints

```
GET /health
Returns:
{
  "status": "healthy|degraded",
  "models": {...},
  "queue": {
    "queues": {...},
    "system": {
      "memory_percent": 45.2,
      "cpu_percent": 65.5,
      "memory_status": "healthy"
    }
  }
}

GET /api/queue/stats
Returns detailed queue statistics:
{
  "queues": {
    "bg_fast": {
      "queued": 2,
      "active": 3,
      "capacity": 3,
      "utilization": "100.0%"
    },
    ...
  },
  "stats": {
    "total_jobs": 150,
    "completed_jobs": 145,
    "failed_jobs": 3,
    "timeout_jobs": 2,
    "rejected_jobs": 5
  },
  "system": {...}
}
```

### Logging

```
Application Logs (stdout):
├─ Job submission
├─ Job completion/failure
├─ Memory warnings
├─ Model loading
└─ Request errors

Docker Logs:
├─ Container lifecycle
├─ Health check results
└─ Resource usage

Nginx Logs:
├─ Access logs (buffered)
├─ Error logs
└─ Rate limit violations
```

## 🔐 Security Layers

```
Layer 1: Firewall (iptables)
├─ Allow: 22 (SSH), 80 (HTTP), 443 (HTTPS)
└─ Block: everything else

Layer 2: Nginx
├─ Rate limiting per IP
├─ Request size limits
├─ SSL/TLS termination
└─ Security headers

Layer 3: CORS
├─ Allowed origins (Vercel URLs)
└─ Reject other origins

Layer 4: Authentication
├─ Firebase token verification
├─ Session management
└─ User-specific rate limits

Layer 5: Application
├─ File type validation
├─ File size limits
├─ Input sanitization
└─ Temporary file cleanup

Layer 6: Queue
├─ Memory-based rejection
├─ Queue size limits
├─ Job timeouts
└─ Resource isolation
```

## 🎯 Scaling Considerations

### Vertical Scaling (More Resources)
```
Current: 24GB RAM, 4 vCPUs

Upgrade to 32GB RAM, 6 vCPUs:
├─ BG Fast: 3 → 4 workers
├─ BG Pro: 2 → 3 workers
├─ Obj Remove: 1 → 2 workers
└─ Gunicorn: 4 → 6 workers
```

### Horizontal Scaling (Multiple Servers)
```
Add Load Balancer:
├─ Server 1 (24GB)
│   └─ Queue Manager 1
├─ Server 2 (24GB)
│   └─ Queue Manager 2
└─ Shared:
    ├─ Firebase (auth)
    ├─ Cloudflare R2 (storage)
    └─ Redis (optional, for distributed queue)
```

## 📈 Performance Characteristics

### Throughput (requests/minute)

```
BG Fast (3 workers):
├─ Best case (person, small images): 180/min
├─ Average case: 90/min
└─ Worst case (large images): 45/min

BG Pro (2 workers):
├─ Best case (small images): 40/min
├─ Average case: 24/min
└─ Worst case (large images): 12/min

Mixed Workload (50% fast, 50% pro):
├─ Average: ~60/min total
└─ Peak: ~100/min total
```

### Latency (seconds)

```
Request → Response:
├─ Fast mode (no queue): 1-3s
├─ Fast mode (queued): 3-10s
├─ Pro mode (no queue): 3-7s
└─ Pro mode (queued): 10-30s
```

## 🎓 Key Design Decisions

1. **Separate Queues**: Fast and Pro jobs don't block each other
2. **Memory Safety**: Auto-rejection prevents OOM crashes
3. **Job Timeouts**: Prevents zombie requests
4. **Background R2 Upload**: Non-blocking response
5. **Thread Pool**: Matches combined queue capacity
6. **Gunicorn Workers**: 1 per vCPU for I/O handling
7. **Nginx Buffering**: Off for uploads, on for responses
8. **Docker Resource Limits**: Prevents runaway containers

---

This architecture provides a robust, scalable, and production-ready background removal service optimized for Oracle Cloud with 24GB RAM and 4 vCPUs! 🚀
