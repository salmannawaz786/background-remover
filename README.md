# Background Remover - AI-Powered with Smart Queue System

<div align="center">

[![Production Ready](https://img.shields.io/badge/production-ready-brightgreen.svg)](https://github.com)
[![Dynamic Scaling](https://img.shields.io/badge/dynamic-scaling-blue.svg)](DYNAMIC_SCALING.md)
[![Oracle Cloud](https://img.shields.io/badge/oracle-cloud-red.svg)](oracle-deploy/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Remove backgrounds from images instantly with AI**

[Features](#features) • [Quick Start](#quick-start) • [Demo](#demo) • [Deploy](#deploy) • [Docs](#documentation)

</div>

---

## ✨ Features

- 🎯 **Three AI Models** - Fast mode (RVM, U2Net-P) and Pro mode (BiRefNet)
- 🚀 **Dynamic Scaling** - Auto-adjusts workers based on demand (3-5 fast, 2-3 pro)
- ⚡ **60% More Throughput** - Intelligent resource allocation during peak times
- 💾 **Memory Safe** - Auto-rejects jobs when RAM > 85%, scales down when > 75%
- 🔒 **Production Ready** - Rate limiting, auth, monitoring, auto-restart
- 📊 **Real-time Monitoring** - Queue stats, health checks, scaling metrics
- 🐳 **One-Command Deploy** - Complete Oracle Cloud setup in 15 minutes
- 📱 **Multiple Formats** - Output as WebP or PNG

## 🎯 Perfect For

- 🛍️ **E-commerce** - Product photo backgrounds
- 👤 **Portraits** - Professional headshots
- 🎨 **Design** - Creative projects
- 📸 **Photography** - Quick editing

## 🚀 Quick Start

### Deploy to Oracle Cloud (Recommended)

**Time**: 15 minutes | **Cost**: Free (24GB RAM Always Free tier)

```bash
# 1. SSH into your Oracle Cloud server
ssh ubuntu@YOUR_SERVER_IP

# 2. Clone and setup
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy
sudo ./setup-oracle.sh

# 3. Configure (add your Firebase & R2 credentials)
cp .env.example .env
nano .env

# 4. Deploy!
./deploy.sh
```

**→ Detailed guide**: [oracle-deploy/QUICK_START.md](oracle-deploy/QUICK_START.md)

### Run Locally (Development)

```bash
# Install dependencies
pip install -r requirements.txt

# Run server
python server.py
```

## 🎬 Demo

```bash
# Upload an image
curl -X POST http://YOUR_SERVER_IP/upload \
  -F "image_file=@photo.jpg" \
  -F "model=fast" \
  -F "format=webp"

# Check queue stats
curl http://YOUR_SERVER_IP/api/queue/stats | jq
```

**Response**: Processed image with transparent background in < 3 seconds!

## 🎯 How Dynamic Scaling Works

```
Morning (Low Traffic):
├─ BG Fast: 3 workers
├─ BG Pro: 2 workers
└─ Memory: 35%

Lunch Peak (High Traffic):
├─ System detects: High demand + idle resources
├─ Auto-scales: BG Fast 3 → 5, BG Pro 2 → 3 🚀
├─ Throughput: +60% (110 → 175 images/min)
└─ Memory: 60%

Evening (Normalizing):
├─ System detects: Low demand
├─ Auto-scales: Back to base (5→3, 3→2) 📉
└─ Memory: 40%
```

**Result**: Automatic optimization, 60% more throughput when needed!

## 📊 Performance

| Configuration | Throughput | Memory | Workers |
|--------------|------------|--------|---------|
| Base (fixed) | ~110/min | 40-50% | 3+2 |
| Peak (scaled) | ~175/min | 60-70% | 5+3 |
| Improvement | **+60%** | Efficient | Dynamic |

## 🏗️ Architecture

```
Users → Nginx → Gunicorn → Queue Manager → Workers → AI Models
                              ├─ BG Fast (3-5 dynamic)
                              ├─ BG Pro (2-3 dynamic)
                              └─ Obj Remove (1 reserved)
```

- **Nginx**: Rate limiting, SSL, reverse proxy
- **Queue Manager**: Dynamic scaling, memory protection
- **Workers**: Process images concurrently
- **AI Models**: RVM, U2Net-P, BiRefNet

**→ Full architecture**: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)

## 📚 Documentation

| Document | Description | Time |
|----------|-------------|------|
| **[START_HERE.md](START_HERE.md)** | 🎯 Start here! Choose your path | 5 min |
| **[QUICK_START.md](oracle-deploy/QUICK_START.md)** | ⚡ Deploy in 5 minutes | 5 min |
| **[WHATS_NEW.md](WHATS_NEW.md)** | ✨ New features overview | 10 min |
| **[DYNAMIC_SCALING.md](DYNAMIC_SCALING.md)** | 🚀 How auto-scaling works | 15 min |
| **[README.md](oracle-deploy/README.md)** | 📖 Complete deployment guide | 20 min |
| **[COMMAND_REFERENCE.md](COMMAND_REFERENCE.md)** | 🔧 All commands | Reference |

## 🎛️ Configuration

### Queue Settings

Edit `queue_manager.py`:

```python
SmartQueueManager(
    bg_fast_workers=3,              # Base capacity
    bg_pro_workers=2,               # Base capacity
    enable_dynamic_scaling=True,    # Auto-adjust workers
    scaling_check_interval=5.0      # Check every 5 seconds
)
```

### Scaling Limits

```python
max_capacity = {
    JobType.BG_FAST: 5,    # Can scale from 3 to 5
    JobType.BG_PRO: 3,     # Can scale from 2 to 3
}
```

## 🔍 Monitoring

### Health Check

```bash
curl http://YOUR_SERVER_IP/health
```

```json
{
  "status": "healthy",
  "memory_usage": "45.2%",
  "models": {
    "fast": {"size_mb": 19.0},
    "pro": {"size_mb": 98.0}
  }
}
```

### Queue Statistics

```bash
curl http://YOUR_SERVER_IP/api/queue/stats | jq
```

```json
{
  "queues": {
    "bg_fast": {
      "capacity": 5,
      "base_capacity": 3,
      "active": 4,
      "queued": 2,
      "scaled": true,
      "scale_direction": "UP"
    }
  },
  "dynamic_scaling": {
    "enabled": true,
    "current_boost": 3
  },
  "system": {
    "memory_percent": 58.5,
    "cpu_percent": 65.2,
    "memory_status": "healthy"
  }
}
```

### Real-time Monitoring

```bash
# Watch queue stats
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq .queues'

# Watch logs
docker-compose logs -f bg-remover

# System resources
htop
docker stats
```

## 💰 Cost

### Oracle Cloud Always Free Tier
- ✅ 4 ARM VMs with 24GB RAM total: **FREE**
- ✅ 100GB storage: **FREE**
- ✅ 10TB outbound transfer/month: **FREE**

### Beyond Free Tier
- VM.Standard.E2.4 (4 vCPUs, 32GB RAM): ~$36/month

## 🔒 Security Features

- ✅ Firebase authentication
- ✅ Rate limiting (10 uploads/min per IP)
- ✅ CORS restrictions
- ✅ File size limits (5MB free, 10MB auth)
- ✅ Input validation
- ✅ Automatic cleanup of temp files

## 🛠️ Tech Stack

**Backend**:
- Python 3.10
- Flask + Gunicorn
- ONNX Runtime
- OpenCV, PIL

**AI Models**:
- RVM (Robust Video Matting)
- U2Net-P (lightweight)
- BiRefNet Lite (high quality)

**Infrastructure**:
- Docker + Docker Compose
- Nginx (reverse proxy)
- Systemd (auto-restart)

**Storage**:
- Cloudflare R2 (processed images)
- Local cache (ONNX models)

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Background removal models: U2Net, RVM, BiRefNet
- Oracle Cloud for Always Free tier
- Cloudflare for R2 storage
- Firebase for authentication

## 🆘 Support

- 📖 **Documentation**: [START_HERE.md](START_HERE.md)
- 🐛 **Issues**: [GitHub Issues](https://github.com/yourusername/background-remover/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/yourusername/background-remover/discussions)

## ⭐ Star History

If this project helped you, please consider giving it a star! ⭐

---

<div align="center">

**[Get Started](START_HERE.md)** • **[Deploy Now](oracle-deploy/QUICK_START.md)** • **[View Demo](#demo)**

Made with ❤️ for developers who need background removal at scale

</div>
