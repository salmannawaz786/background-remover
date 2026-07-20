# Background Remover - Deployment Summary

## 🎯 What Was Done

### 1. Smart Queue System (NEW ✨)
Created `queue_manager.py` with intelligent concurrency control:

**For 24GB RAM / 4 vCPUs Oracle Cloud:**
- **BG Fast mode**: 3 concurrent workers (RVM/U2Net-P, ~500MB each)
- **BG Pro mode**: 2 concurrent workers (BiRefNet, ~2GB each)  
- **Object Removal**: 1 concurrent worker (Big-Lama, ~3GB) - ready for future use

**Key Features:**
- ✅ Separate queues prevent fast jobs from being blocked by slow jobs
- ✅ Automatic memory monitoring and throttling (rejects jobs when RAM > 85%)
- ✅ Job timeout handling (no zombie requests)
- ✅ Real-time queue statistics endpoint
- ✅ Graceful degradation under high load
- ✅ Per-job tracking with wait time and processing time metrics

### 2. Updated Server Integration
Modified `server.py` to use the queue system:
- Replaced old semaphore-based lanes with smart queue manager
- Integrated job submission and waiting
- Added queue stats to response headers
- Improved error handling with user-friendly messages
- Added `/api/queue/stats` endpoint for monitoring

### 3. Production Docker Setup
Created `Dockerfile.production`:
- Multi-stage build for smaller image size
- Optimized for AI workloads
- Health checks built-in
- Gunicorn with optimal worker configuration
- Environment variable support

### 4. Oracle Cloud Deployment Package
Complete deployment setup in `oracle-deploy/`:

**Files Created:**
- `docker-compose.yml` - Container orchestration with resource limits
- `nginx.conf` - Reverse proxy with rate limiting
- `setup-oracle.sh` - Automated server setup script
- `deploy.sh` - One-command deployment
- `README.md` - Comprehensive deployment guide
- `QUICK_START.md` - 5-minute deployment guide
- `.env.example` - Environment variable template

**What the Scripts Do:**
- Install Docker & Docker Compose
- Configure firewall (ports 80, 443, 22)
- Optimize system for AI workloads (swappiness, file descriptors, network)
- Set up application directory
- Configure systemd service for auto-restart
- Deploy with health checks

### 5. Nginx Reverse Proxy
Configured with:
- Rate limiting (10 uploads/min per IP, 30 API calls/min)
- Proper timeouts for image processing (180s)
- Gzip compression
- Connection pooling
- Health check bypass (no logging)
- Ready for SSL/HTTPS (commented out, easy to enable)

## 📊 Queue System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Incoming Requests                        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Request Classification                          │
│  • Fast Mode (RVM/U2Net-P)                                   │
│  • Pro Mode (BiRefNet)                                       │
│  • Object Removal (Big-Lama) - future                        │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┴────────┬────────────────┐
        ▼                 ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  BG Fast     │  │  BG Pro      │  │  Obj Remove  │
│  Queue       │  │  Queue       │  │  Queue       │
│              │  │              │  │              │
│ Capacity: 3  │  │ Capacity: 2  │  │ Capacity: 1  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Worker 1     │  │ Worker 1     │  │ Worker 1     │
│ Worker 2     │  │ Worker 2     │  │              │
│ Worker 3     │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
       │                 │                 │
       └─────────────────┴─────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   Response   │
                  └──────────────┘
```

## 🚀 Deployment Steps

### For Oracle Cloud (Recommended for Payasugo users with 24GB RAM):

1. **Provision Instance**
   - Shape: VM.Standard.E2.4 (4 vCPUs, 32GB RAM) or custom with 24GB RAM
   - OS: Ubuntu 22.04
   - Boot volume: 100GB
   - Assign public IP

2. **Initial Setup** (5 minutes)
   ```bash
   ssh ubuntu@YOUR_SERVER_IP
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/yourusername/background-remover.git
   cd background-remover/oracle-deploy
   sudo chmod +x setup-oracle.sh
   sudo ./setup-oracle.sh
   ```

3. **Configure Environment** (2 minutes)
   ```bash
   cd /opt/bg-remover/oracle-deploy
   cp .env.example .env
   nano .env
   # Fill in your Firebase and R2 credentials
   ```

4. **Deploy** (10 minutes - downloads models)
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

5. **Verify**
   ```bash
   curl http://localhost:5000/health
   curl http://localhost:5000/api/queue/stats
   ```

6. **Update Frontend on Vercel**
   ```env
   NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP
   ```

### For Local Development:

No queue needed! Local version runs directly without queue limits since it's using the user's own resources.

The frontend can detect if it's local (localhost) and skip queue-related UI.

## 📊 Monitoring

### Health Check
```bash
curl http://YOUR_SERVER_IP/health
```

Response:
```json
{
  "status": "healthy",
  "models": {
    "fast": {"name": "Smart Fast", "size_mb": 19.0},
    "pro": {"name": "Smart Pro", "size_mb": 98.0}
  },
  "queue": {
    "queues": {
      "bg_fast": {"queued": 0, "active": 2, "capacity": 3},
      "bg_pro": {"queued": 1, "active": 2, "capacity": 2}
    },
    "total_queued": 1,
    "total_active": 4,
    "system": {
      "memory_percent": 45.2,
      "memory_available_gb": 13.1,
      "cpu_percent": 65.5,
      "memory_status": "healthy"
    },
    "stats": {
      "total_jobs": 150,
      "completed_jobs": 145,
      "failed_jobs": 3,
      "timeout_jobs": 2
    }
  }
}
```

### Queue Stats
```bash
curl http://YOUR_SERVER_IP/api/queue/stats | jq
```

### Real-time Monitoring
```bash
# Watch queue stats
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq'

# Monitor resources
htop
docker stats

# View logs
docker-compose logs -f bg-remover
```

## 🎛️ Configuration Options

### Adjust Worker Counts
Edit `queue_manager.py` (line ~300):
```python
_queue_manager = SmartQueueManager(
    bg_fast_workers=3,     # Increase if you need more fast jobs
    bg_pro_workers=2,      # Increase if you need more pro jobs
    obj_remove_workers=1,  # For object removal (future)
    max_queue_size=50,     # Max jobs waiting in each queue
    job_timeout=60         # Max time for job to wait/process
)
```

### Adjust Memory Thresholds
Edit `queue_manager.py` initialization:
```python
memory_critical_threshold=85,  # Reject jobs above this %
memory_warning_threshold=75    # Log warnings above this %
```

### Adjust Gunicorn Workers
Edit `docker-compose.yml`:
```yaml
environment:
  - WORKERS=4  # 1 per vCPU is recommended
```

## 🔐 Security Features

- ✅ Firewall configured (only ports 80, 443, 22 open)
- ✅ CORS restricted to your frontend domains
- ✅ Rate limiting in Nginx (10 uploads/min, 30 API calls/min)
- ✅ File size limits (5MB free, 10MB authenticated)
- ✅ Environment variables secured (not in git)
- ✅ Health checks don't expose sensitive data
- ✅ Automatic cleanup of temporary files

## 💰 Cost Estimate

### Oracle Cloud Free Tier (for Payasugo users)
- Up to 4 ARM VMs with total 24GB RAM: **FREE**
- 100GB boot volume: **FREE**
- First 10TB outbound transfer/month: **FREE**

### If Exceeding Free Tier
- VM.Standard.E2.4 (4 vCPUs, 32GB RAM): ~$36/month
- Block storage (100GB): ~$2.55/month
- Total: ~$40/month

## 📈 Expected Performance

With 24GB RAM and 4 vCPUs:

| Mode | Model | Concurrent | Processing Time | Memory/Job |
|------|-------|-----------|----------------|------------|
| Fast (Person) | RVM | 3 | 1-2s | ~500MB |
| Fast (Object) | U2Net-P | 3 | 1-2s | ~500MB |
| Pro | BiRefNet | 2 | 3-5s | ~2GB |
| Object Remove | Big-Lama | 1 | 5-10s | ~3GB |

**Throughput:**
- Fast mode: ~90-180 images/minute (with 3 workers)
- Pro mode: ~24-40 images/minute (with 2 workers)
- Mixed workload: Automatically balanced

## 🐛 Troubleshooting

### Queue is backing up
```bash
# Check what's happening
curl http://localhost:5000/api/queue/stats

# Common causes:
# 1. Too many pro jobs (slow) - increase pro workers
# 2. High memory usage - check docker stats
# 3. Models not loaded - check logs

# Solution: Adjust workers in queue_manager.py
```

### High memory usage
```bash
# Check memory
free -h
docker stats

# Restart to free memory
docker-compose restart bg-remover

# Reduce workers if memory is always high
```

### Models not loading
```bash
# Check if models exist
docker exec -it bg-remover-api ls -lh .onnx_cache/

# Download manually
docker exec -it bg-remover-api python -c "from model_manager_v4 import get_model_manager; m = get_model_manager()"

# Check logs
docker-compose logs -f bg-remover | grep -i "model\|download"
```

## 🎯 Next Steps

1. **Deploy to Oracle Cloud** - Follow QUICK_START.md
2. **Configure SSL/HTTPS** - Use Let's Encrypt (instructions in README.md)
3. **Set up monitoring** - Optional Prometheus/Grafana
4. **Test with load** - Use Apache Bench or similar
5. **Tune workers** - Based on actual usage patterns

## 📚 Documentation

- **QUICK_START.md** - 5-minute deployment guide
- **oracle-deploy/README.md** - Comprehensive deployment documentation
- **queue_manager.py** - Queue system implementation with detailed comments
- **server.py** - Flask server with queue integration

## 🆘 Support

If you encounter issues:
1. Check logs: `docker-compose logs -f bg-remover`
2. Check queue: `curl http://localhost:5000/api/queue/stats`
3. Check system: `free -h`, `df -h`, `htop`
4. Review documentation
5. Open GitHub issue with logs and queue stats

## ✅ Summary

You now have:
- ✅ Production-ready queue system optimized for 24GB RAM / 4 vCPUs
- ✅ Complete Oracle Cloud deployment setup
- ✅ Automated deployment scripts
- ✅ Monitoring and health checks
- ✅ Security best practices
- ✅ Comprehensive documentation

**Deploy command:** `cd oracle-deploy && ./deploy.sh`

**Monitor command:** `curl http://YOUR_SERVER_IP/api/queue/stats | jq`

That's it! Your background remover is ready for production deployment! 🚀
