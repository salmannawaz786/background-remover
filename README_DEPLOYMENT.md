# Background Remover - Production Deployment Guide

## 🎯 Overview

This background remover application is designed to run in two modes:

1. **Production (Oracle Cloud)** - With smart queue system for concurrent users
2. **Local Development** - Direct processing without queue (uses user's own resources)

## ✨ What's New - Smart Queue System

For production deployment, we've implemented an intelligent queue system optimized for **24GB RAM / 4 vCPUs**:

- **BG Fast mode**: 3 concurrent workers (RVM/U2Net-P, ~500MB each)
- **BG Pro mode**: 2 concurrent workers (BiRefNet, ~2GB each)
- **Object Removal**: 1 concurrent worker (Big-Lama, ~3GB) - ready for future

### Key Features:
✅ Separate queues prevent fast jobs from being blocked by slow ones  
✅ Automatic memory monitoring and throttling  
✅ Real-time queue statistics and monitoring  
✅ Graceful degradation under high load  
✅ Per-job tracking with metrics  

## 🚀 Quick Start

### For Oracle Cloud Deployment:

See [oracle-deploy/QUICK_START.md](oracle-deploy/QUICK_START.md) for 5-minute deployment guide.

**TL;DR:**
```bash
# On Oracle server
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy
sudo ./setup-oracle.sh
# Edit .env with your credentials
./deploy.sh
```

### For Local Development:

```bash
# Install dependencies
pip install -r requirements.txt

# Run server (no queue needed for local)
python server.py
```

## 📁 Project Structure

```
background-remover/
├── server.py                     # Main Flask application (updated with queue)
├── queue_manager.py              # Smart queue system (NEW)
├── model_manager_v4.py           # AI model management
├── requirements.txt              # Python dependencies
├── Dockerfile.production         # Production Docker image
│
├── oracle-deploy/               # Oracle Cloud deployment
│   ├── QUICK_START.md          # 5-minute deployment guide
│   ├── README.md               # Comprehensive deployment docs
│   ├── pre-deploy-checklist.md # What you need before deploying
│   ├── docker-compose.yml      # Container orchestration
│   ├── nginx.conf              # Reverse proxy with rate limiting
│   ├── setup-oracle.sh         # Automated server setup
│   ├── deploy.sh               # One-command deployment
│   ├── .env.example            # Environment variables template
│   └── test-queue-local.py     # Local queue testing script
│
└── DEPLOYMENT_SUMMARY.md       # Complete deployment documentation
```

## 📋 Pre-Deployment Checklist

Before deploying to Oracle Cloud, make sure you have:

1. ✅ Oracle Cloud instance (24GB RAM, 4 vCPUs recommended)
2. ✅ Firebase project with Authentication enabled
3. ✅ Cloudflare R2 bucket for image storage
4. ✅ Vercel frontend deployment URL
5. ✅ All credentials ready (Firebase, R2, etc.)

See [oracle-deploy/pre-deploy-checklist.md](oracle-deploy/pre-deploy-checklist.md) for detailed checklist.

## 🔧 Configuration

### Environment Variables

Create `oracle-deploy/.env` from `.env.example`:

```env
# Firebase Authentication
FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
# ... other Firebase config

# Cloudflare R2 Storage
R2_ENDPOINT=https://...r2.cloudflarestorage.com
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET_NAME=...

# CORS - Your Vercel frontend URLs
EXTRA_ALLOWED_ORIGINS=https://your-app.vercel.app

# App URL (your Oracle server IP)
APP_URL=http://YOUR_SERVER_IP
```

### Queue Configuration

Edit `queue_manager.py` to adjust workers (around line 300):

```python
_queue_manager = SmartQueueManager(
    bg_fast_workers=3,      # Fast mode concurrent workers
    bg_pro_workers=2,       # Pro mode concurrent workers
    obj_remove_workers=1,   # Object removal workers
    max_queue_size=50,      # Max queued jobs per type
    job_timeout=60          # Max seconds to wait/process
)
```

## 📊 Monitoring

### Health Check
```bash
curl http://YOUR_SERVER_IP/health
```

### Queue Statistics
```bash
curl http://YOUR_SERVER_IP/api/queue/stats
```

Response shows:
- Current queue lengths
- Active workers per type
- System memory and CPU usage
- Total jobs processed, failed, timed out
- Performance metrics

### Real-time Monitoring
```bash
# Watch queue stats
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq'

# Monitor Docker containers
docker stats

# View logs
docker-compose -f oracle-deploy/docker-compose.yml logs -f
```

## 🏗️ Architecture

### Production (Oracle Cloud)

```
Internet → Nginx (rate limiting) → Flask (Gunicorn) → Queue Manager → Workers
                                                           ├─ BG Fast (3 workers)
                                                           ├─ BG Pro (2 workers)
                                                           └─ Obj Remove (1 worker)
```

- **Nginx**: Reverse proxy, rate limiting, SSL termination
- **Gunicorn**: WSGI server with 4 workers
- **Queue Manager**: Distributes jobs to appropriate worker pool
- **Workers**: Process images concurrently with memory safety

### Local Development

```
Flask dev server → Direct processing (no queue)
```

Local mode processes images directly since it's using the user's own resources.

## 🔒 Security

- ✅ Firewall configured (only ports 80, 443, 22)
- ✅ CORS restricted to your frontend domains
- ✅ Rate limiting (10 uploads/min per IP, 30 API calls/min)
- ✅ File size limits (5MB free users, 10MB authenticated)
- ✅ Environment variables secured (not in git)
- ✅ Automatic cleanup of temporary files
- ✅ Input validation and sanitization

## 📈 Performance

Expected performance with 24GB RAM / 4 vCPUs:

| Mode | Processing Time | Throughput | Memory/Job |
|------|----------------|------------|------------|
| Fast (Person) | 1-2s | ~90-180/min | ~500MB |
| Fast (Object) | 1-2s | ~90-180/min | ~500MB |
| Pro | 3-5s | ~24-40/min | ~2GB |

## 🐛 Troubleshooting

### Container won't start
```bash
docker-compose -f oracle-deploy/docker-compose.yml logs bg-remover
```

### Queue backing up
```bash
# Check queue stats
curl http://localhost:5000/api/queue/stats

# If needed, increase workers in queue_manager.py
```

### High memory usage
```bash
free -h
docker stats
docker-compose restart bg-remover
```

### Models not loading
```bash
# Check model files
docker exec -it bg-remover-api ls -lh .onnx_cache/

# View download logs
docker-compose logs -f | grep -i "model\|download"
```

See [oracle-deploy/README.md](oracle-deploy/README.md) for detailed troubleshooting.

## 💰 Costs

### Oracle Cloud Free Tier (Payasugo users)
- Up to 4 ARM VMs with 24GB RAM total: **FREE**
- 100GB storage: **FREE**
- 10TB outbound transfer/month: **FREE**

### Beyond Free Tier
- VM.Standard.E2.4 (4 vCPUs, 32GB RAM): ~$36/month
- Additional storage: ~$0.0255/GB/month

## 📚 Documentation

- **[oracle-deploy/QUICK_START.md](oracle-deploy/QUICK_START.md)** - Get started in 5 minutes
- **[oracle-deploy/README.md](oracle-deploy/README.md)** - Comprehensive deployment guide
- **[oracle-deploy/pre-deploy-checklist.md](oracle-deploy/pre-deploy-checklist.md)** - Pre-deployment checklist
- **[DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)** - Technical architecture and changes
- **[queue_manager.py](queue_manager.py)** - Queue system source code (well documented)

## 🧪 Testing

Test the queue system locally before deploying:

```bash
python oracle-deploy/test-queue-local.py
```

This simulates multiple concurrent jobs and verifies the queue system works correctly.

## 🔄 Deployment Workflow

1. **Develop locally** - No queue, direct processing
2. **Test queue locally** - Run test script
3. **Commit to git** - Push changes
4. **Deploy to Oracle** - Run deployment scripts
5. **Update frontend** - Point to new API URL
6. **Monitor** - Check health and queue stats
7. **Scale as needed** - Adjust workers based on usage

## 🆘 Support

If you need help:

1. Check logs: `docker-compose logs -f`
2. Check queue: `curl http://localhost:5000/api/queue/stats`
3. Check system: `free -h`, `df -h`, `htop`
4. Review documentation
5. Open GitHub issue with:
   - Error logs
   - Queue stats output
   - System resource usage

## 📝 License

[Your License Here]

## 🙏 Credits

- Background removal models: U2Net, RVM, BiRefNet
- Queue system: Custom implementation for this project
- Deployment: Optimized for Oracle Cloud

---

**Ready to deploy?** Start with [oracle-deploy/QUICK_START.md](oracle-deploy/QUICK_START.md)

**Need help?** Check [oracle-deploy/README.md](oracle-deploy/README.md) for detailed documentation
