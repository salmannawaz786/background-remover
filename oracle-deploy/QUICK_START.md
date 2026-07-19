# Quick Start Guide - Oracle Cloud Deployment

## 🚀 5-Minute Deployment

### Prerequisites
- Oracle Cloud account with a VM instance (24GB RAM, 4 vCPUs recommended)
- SSH access to your server
- Your Firebase and Cloudflare R2 credentials ready

### Step 1: SSH into Your Server
```bash
ssh ubuntu@YOUR_SERVER_IP
```

### Step 2: Run the Setup Script
```bash
# Download the project
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy

# Run setup (installs Docker, configures system)
sudo chmod +x setup-oracle.sh
sudo ./setup-oracle.sh
```

This takes 2-3 minutes and sets up:
- Docker & Docker Compose
- Firewall rules (ports 80, 443, 22)
- System optimizations for AI workloads
- Application directory at `/opt/bg-remover`

### Step 3: Configure Environment
```bash
cd /opt/bg-remover
cp oracle-deploy/.env.example oracle-deploy/.env
nano oracle-deploy/.env
```

Fill in your credentials:
- Firebase credentials (from Firebase Console → Project Settings → Service Accounts)
- Cloudflare R2 credentials (from Cloudflare Dashboard → R2)
- Your Vercel frontend URL in `EXTRA_ALLOWED_ORIGINS`

**Generate a secret key:**
```bash
SECRET_KEY=$(openssl rand -hex 32)
echo "SECRET_KEY=$SECRET_KEY"
```

### Step 4: Deploy
```bash
cd oracle-deploy
chmod +x deploy.sh
./deploy.sh
```

This takes 5-10 minutes (downloads models, builds containers).

### Step 5: Verify
```bash
# Check health
curl http://localhost:5000/health

# Check queue stats
curl http://localhost:5000/api/queue/stats

# View logs
docker-compose logs -f bg-remover
```

Expected output:
```json
{
  "status": "healthy",
  "models": {
    "fast": {"name": "Smart Fast", "size_mb": 19.0},
    "pro": {"name": "Smart Pro", "size_mb": 98.0}
  },
  "queue": {
    "queues": {
      "bg_fast": {"queued": 0, "active": 0, "capacity": 3},
      "bg_pro": {"queued": 0, "active": 0, "capacity": 2}
    },
    "system": {"memory_percent": 25.5, "memory_status": "healthy"}
  }
}
```

### Step 6: Update Frontend
Update your Next.js environment variable on Vercel:
```env
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP
```

Then redeploy:
```bash
vercel --prod
```

## ✅ Done!

Your API is now running at: `http://YOUR_SERVER_IP`

## 🎯 Quick Commands

```bash
# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down

# Check stats
curl http://localhost:5000/api/queue/stats | jq

# Monitor resources
htop
docker stats
```

## 🔧 Troubleshooting

**Container won't start:**
```bash
docker-compose logs bg-remover
```

**Models not loading:**
```bash
docker exec -it bg-remover-api ls -lh .onnx_cache/
```

**High memory:**
```bash
docker stats
curl http://localhost:5000/api/queue/stats
docker-compose restart
```

## 📚 Full Documentation

See [README.md](README.md) for:
- Detailed architecture
- SSL/HTTPS setup
- Performance tuning
- Monitoring
- Security best practices

## 🆘 Need Help?

1. Check logs: `docker-compose logs -f`
2. Check queue: `curl http://localhost:5000/api/queue/stats`
3. Check system: `free -h` and `df -h`
4. Review [README.md](README.md)
5. Open GitHub issue with logs
