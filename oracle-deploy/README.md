# Background Remover - Oracle Cloud Deployment Guide

This guide covers deploying the Background Remover API to Oracle Cloud Infrastructure (OCI) with 24GB RAM and 4 vCPUs.

## Architecture

### Queue System (24GB RAM / 4 vCPUs)
- **BG Fast mode**: 3 concurrent workers (RVM/U2Net-P, ~500MB each)
- **BG Pro mode**: 2 concurrent workers (BiRefNet, ~2GB each)
- **Object Removal**: 1 concurrent worker (Big-Lama, ~3GB) [for future use]

### Key Features
- ✅ Smart queue management with lane-based concurrency
- ✅ Automatic memory monitoring and throttling
- ✅ Separate queues prevent fast jobs from being blocked by slow ones
- ✅ Graceful degradation under high load
- ✅ Docker containerization with health checks
- ✅ Nginx reverse proxy with rate limiting
- ✅ Auto-restart on failure

## Prerequisites

1. Oracle Cloud account (Always Free or PAYG)
2. Ubuntu 22.04 VM instance (24GB RAM, 4 vCPUs)
3. SSH access to the instance
4. Domain name (optional, for SSL)

## Step 1: Provision Oracle Cloud Instance

### Create Instance
1. Log into Oracle Cloud Console
2. Navigate to **Compute** → **Instances** → **Create Instance**
3. Configuration:
   - **Name**: `bg-remover-api`
   - **Image**: Ubuntu 22.04
   - **Shape**: VM.Standard.E2.4 (4 vCPUs, 32GB RAM) or custom with 24GB RAM
   - **Boot Volume**: 100GB
   - **VCN**: Create new or use existing
   - **Public IP**: Assign a public IP

### Configure Security List
1. Go to **Networking** → **Virtual Cloud Networks**
2. Select your VCN → **Security Lists**
3. Add Ingress Rules:
   - **HTTP**: Source `0.0.0.0/0`, Port `80`
   - **HTTPS**: Source `0.0.0.0/0`, Port `443`
   - **SSH**: Source `0.0.0.0/0`, Port `22`

## Step 2: Initial Server Setup

SSH into your instance:
```bash
ssh ubuntu@YOUR_SERVER_IP
```

Download and run the setup script:
```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy
sudo chmod +x setup-oracle.sh
sudo ./setup-oracle.sh
```

This script will:
- Install Docker and Docker Compose
- Configure firewall rules
- Optimize system parameters for AI workloads
- Create application directory at `/opt/bg-remover`
- Set up systemd service for auto-start

## Step 3: Deploy Application

### Upload Files
From your local machine, upload the application:
```bash
# Option 1: Using rsync
rsync -avz --exclude '.venv' --exclude 'node_modules' --exclude '.git' \
  /path/to/background-remover/ ubuntu@YOUR_SERVER_IP:/opt/bg-remover/

# Option 2: Using git (recommended)
ssh ubuntu@YOUR_SERVER_IP
cd /opt/bg-remover
git clone https://github.com/yourusername/background-remover.git .
```

### Configure Environment
Edit `.env` file with your credentials:
```bash
cd /opt/bg-remover/oracle-deploy
nano .env
```

Required environment variables:
```env
# Firebase Authentication
FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef
FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Cloudflare R2 Storage
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_ACCESS_KEY=your_access_key
R2_SECRET_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket
R2_PUBLIC_DOMAIN=https://your-cdn.com

# CORS - Add your Vercel frontend URL
EXTRA_ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://your-frontend-preview.vercel.app

# App URL
APP_URL=http://YOUR_SERVER_IP
```

### Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```

## Step 4: Verify Deployment

Check service status:
```bash
# Docker containers
docker-compose ps

# View logs
docker-compose logs -f bg-remover

# Health check
curl http://YOUR_SERVER_IP/health

# Queue stats
curl http://YOUR_SERVER_IP/api/queue/stats
```

Expected health check response:
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
    "system": {
      "memory_percent": 25.5,
      "cpu_percent": 10.2,
      "memory_status": "healthy"
    }
  }
}
```

## Step 5: Configure Frontend (Vercel)

Update your Next.js environment variables on Vercel:

```env
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP
```

Deploy frontend:
```bash
cd /path/to/frontend
vercel --prod
```

## Step 6: Optional - SSL with Let's Encrypt

### Install Certbot
```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### Update Nginx Config
Edit `oracle-deploy/nginx.conf` and uncomment the HTTPS server block.

### Get Certificate
```bash
sudo certbot --nginx -d your-domain.com
```

### Auto-renewal
Certbot automatically sets up renewal. Test it:
```bash
sudo certbot renew --dry-run
```

## Management Commands

### Service Control
```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View status
docker-compose ps

# View logs
docker-compose logs -f bg-remover

# View specific container logs
docker logs -f bg-remover-api
```

### System Management
```bash
# Check systemd service
sudo systemctl status bg-remover

# Enable auto-start
sudo systemctl enable bg-remover

# Restart via systemd
sudo systemctl restart bg-remover

# View system resources
htop
docker stats
```

### Monitor Queue
```bash
# Watch queue stats in real-time
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq'

# Check memory usage
free -h

# Check disk usage
df -h
```

### Cleanup
```bash
# Remove old Docker images
docker image prune -a

# Remove old containers
docker container prune

# Remove unused volumes
docker volume prune

# Clean up old uploaded files (automated via app)
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs bg-remover

# Check Docker daemon
sudo systemctl status docker

# Rebuild container
docker-compose build --no-cache
docker-compose up -d
```

### High memory usage
```bash
# Check current usage
docker stats

# View queue stats
curl http://localhost:5000/api/queue/stats

# Restart to free memory
docker-compose restart bg-remover
```

### Models not loading
```bash
# Check if model files exist
ls -lh /opt/bg-remover/.onnx_cache/

# Download models manually
docker exec -it bg-remover-api python -c "from model_manager_v4 import get_model_manager; m = get_model_manager()"

# Check logs for download errors
docker-compose logs -f bg-remover | grep -i "download\|model"
```

### Queue is backing up
```bash
# Check queue stats
curl http://localhost:5000/api/queue/stats

# Increase workers (edit docker-compose.yml)
# Then restart:
docker-compose up -d

# Monitor system resources
htop
docker stats
```

## Performance Tuning

### Adjust Worker Counts
Edit `docker-compose.yml` environment:
```yaml
environment:
  - WORKERS=4  # Gunicorn workers (1 per vCPU recommended)
```

### Adjust Queue Capacities
Edit `queue_manager.py` initialization:
```python
_queue_manager = SmartQueueManager(
    bg_fast_workers=3,  # Increase if more fast jobs
    bg_pro_workers=2,   # Increase if more pro jobs
    obj_remove_workers=1
)
```

### Memory Thresholds
Edit `queue_manager.py`:
```python
memory_critical_threshold=85,  # Reject new jobs above this
memory_warning_threshold=75    # Log warnings above this
```

## Monitoring

### Set up monitoring (optional)
```bash
# Install Prometheus Node Exporter
docker run -d \
  --name=node-exporter \
  --restart=always \
  -p 9100:9100 \
  prom/node-exporter

# Or use Oracle Cloud Monitoring (built-in)
```

## Backup Strategy

### Database/Config Backup
```bash
# Backup .env file
cp .env .env.backup.$(date +%Y%m%d)

# Backup uploaded files (if needed)
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz /opt/bg-remover/uploads/
```

### Disaster Recovery
```bash
# Full system backup
sudo tar -czf /backup/bg-remover-full-$(date +%Y%m%d).tar.gz \
  /opt/bg-remover/ \
  /etc/systemd/system/bg-remover.service
```

## Costs

### Oracle Cloud Always Free Tier
- 2 AMD VMs with 1/8 OCPU and 1GB RAM each
- 4 ARM VMs with 1-4 OCPUs and 1-24GB RAM total

### PAYG Pricing (if exceeding free tier)
- VM.Standard.E2.4: ~$0.05/hour (~$36/month)
- Block storage: ~$0.0255/GB/month
- Outbound data transfer: First 10TB/month free

## Security Checklist

- ✅ Firewall configured (only ports 80, 443, 22 open)
- ✅ SSL/TLS enabled (if using domain)
- ✅ Environment variables secured (not in git)
- ✅ Rate limiting configured in Nginx
- ✅ CORS restricted to your frontend domains
- ✅ Regular security updates: `sudo apt-get update && sudo apt-get upgrade`

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Check queue stats: `curl http://localhost:5000/api/queue/stats`
3. Check system resources: `htop`, `free -h`, `df -h`
4. Review this README
5. Open GitHub issue with logs

## License

[Your License Here]
