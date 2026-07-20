# Command Reference - Quick Guide

## 🚀 Deployment Commands

### Initial Setup (on Oracle server)
```bash
# Clone repository
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy

# Run automated setup
sudo chmod +x setup-oracle.sh
sudo ./setup-oracle.sh
```

### Configure Environment
```bash
# Copy and edit .env file
cp .env.example .env
nano .env  # or vim .env

# Generate secret key
openssl rand -hex 32
```

### Deploy Application
```bash
# Make deployment script executable
chmod +x deploy.sh

# Deploy (builds and starts containers)
./deploy.sh
```

## 📊 Monitoring Commands

### Health Checks
```bash
# Basic health check
curl http://localhost:5000/health

# Pretty print with jq
curl http://localhost:5000/health | jq

# Watch in real-time
watch -n 5 'curl -s http://localhost:5000/health | jq'
```

### Queue Statistics
```bash
# Get queue stats
curl http://localhost:5000/api/queue/stats

# Pretty print
curl http://localhost:5000/api/queue/stats | jq

# Watch queue in real-time
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq'

# Watch just the queues
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq .queues'

# Watch dynamic scaling status
watch -n 2 'curl -s http://localhost:5000/api/queue/stats | jq .dynamic_scaling'
```

### System Resources
```bash
# Monitor system resources
htop

# Check memory
free -h

# Check disk
df -h

# Check Docker stats
docker stats

# Check specific container
docker stats bg-remover-api
```

## 📝 Log Commands

### View Logs
```bash
# All services
docker-compose logs -f

# Background remover only
docker-compose logs -f bg-remover

# Nginx only
docker-compose logs -f nginx

# Last 100 lines
docker-compose logs --tail=100 bg-remover

# Since specific time
docker-compose logs --since 30m bg-remover
```

### Search Logs
```bash
# Search for scaling events
docker-compose logs bg-remover | grep -i "scaled"

# Search for errors
docker-compose logs bg-remover | grep -i "error"

# Search for memory warnings
docker-compose logs bg-remover | grep -i "memory"

# Search for specific job
docker-compose logs bg-remover | grep "job-id-abc123"

# Follow and search
docker-compose logs -f bg-remover | grep --line-buffered -i "scaled"
```

### Systemd Logs
```bash
# View service status
sudo systemctl status bg-remover

# View service logs
sudo journalctl -u bg-remover -f

# View recent logs
sudo journalctl -u bg-remover -n 100
```

## 🔧 Container Management

### Start/Stop/Restart
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart bg-remover

# Stop specific service
docker-compose stop bg-remover

# Start specific service
docker-compose start bg-remover
```

### Build and Deploy
```bash
# Rebuild containers (after code changes)
docker-compose build --no-cache

# Build and start
docker-compose up -d --build

# Pull latest images
docker-compose pull

# Deploy new version
git pull
docker-compose build
docker-compose up -d
```

### Container Status
```bash
# List running containers
docker-compose ps

# List all containers
docker ps -a

# Inspect container
docker inspect bg-remover-api

# Check container health
docker inspect --format='{{.State.Health.Status}}' bg-remover-api
```

## 🐛 Debugging Commands

### Execute Commands in Container
```bash
# Open shell in container
docker exec -it bg-remover-api /bin/bash

# Check Python version
docker exec bg-remover-api python --version

# Check installed packages
docker exec bg-remover-api pip list

# Check models exist
docker exec bg-remover-api ls -lh .onnx_cache/

# Test model loading
docker exec bg-remover-api python -c "from model_manager_v4 import get_model_manager; m = get_model_manager()"

# Test queue manager
docker exec bg-remover-api python -c "from queue_manager import get_queue_manager; q = get_queue_manager()"
```

### Network Debugging
```bash
# Check if port is listening
sudo netstat -tlnp | grep :5000
sudo netstat -tlnp | grep :80

# Test from inside server
curl http://localhost:5000/health

# Test from outside (replace with your IP)
curl http://YOUR_SERVER_IP/health

# Check firewall rules
sudo iptables -L -n

# Test DNS
nslookup YOUR_DOMAIN
```

### Resource Debugging
```bash
# Check memory usage by process
ps aux --sort=-%mem | head

# Check disk usage
du -sh /opt/bg-remover/*
du -sh /opt/bg-remover/.onnx_cache/
du -sh /opt/bg-remover/uploads/

# Check Docker volumes
docker volume ls
docker volume inspect oracle-deploy_model_cache

# Clean up disk space
docker system prune -a  # CAUTION: Removes unused images
```

## 🧹 Maintenance Commands

### Cleanup
```bash
# Remove old Docker images
docker image prune -a

# Remove stopped containers
docker container prune

# Remove unused volumes
docker volume prune

# Remove everything unused
docker system prune -a --volumes  # CAUTION!

# Clear application uploads (if needed)
rm -rf /opt/bg-remover/uploads/*
```

### Update Application
```bash
# Pull latest code
cd /opt/bg-remover
git pull

# Rebuild and restart
cd oracle-deploy
docker-compose build
docker-compose up -d

# Check if updated
docker-compose logs -f bg-remover
```

### Backup
```bash
# Backup environment file
cp .env .env.backup.$(date +%Y%m%d)

# Backup models (if custom)
tar -czf models-backup-$(date +%Y%m%d).tar.gz .onnx_cache/

# Backup entire application
sudo tar -czf /backup/bg-remover-$(date +%Y%m%d).tar.gz /opt/bg-remover/
```

## 📈 Performance Testing

### Load Testing
```bash
# Single upload test
curl -X POST http://localhost:5000/upload \
  -F "image_file=@test-image.jpg" \
  -F "model=fast" \
  -F "format=webp"

# Measure response time
time curl -X POST http://localhost:5000/upload \
  -F "image_file=@test-image.jpg" \
  -F "model=fast"

# Multiple concurrent requests (requires ab)
ab -n 100 -c 10 -p upload.txt -T multipart/form-data http://localhost:5000/upload
```

### Monitor During Load Test
```bash
# In terminal 1: Start load test
# In terminal 2: Watch queue stats
watch -n 1 'curl -s http://localhost:5000/api/queue/stats | jq'

# In terminal 3: Watch resources
htop

# In terminal 4: Watch logs
docker-compose logs -f bg-remover
```

## 🔐 Security Commands

### SSL/HTTPS Setup (after domain configured)
```bash
# Install certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Test renewal
sudo certbot renew --dry-run

# Check certificate
sudo certbot certificates
```

### Security Updates
```bash
# Update system packages
sudo apt-get update
sudo apt-get upgrade -y

# Update Docker
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Restart services after updates
sudo systemctl restart docker
cd /opt/bg-remover/oracle-deploy
docker-compose restart
```

## 🎯 Quick Troubleshooting

### Container won't start
```bash
docker-compose logs bg-remover
# Check for missing environment variables or model files
```

### High memory usage
```bash
docker stats
curl http://localhost:5000/api/queue/stats | jq .system
docker-compose restart bg-remover
```

### Queue backing up
```bash
curl http://localhost:5000/api/queue/stats | jq .queues
# Check if dynamic scaling is enabled
# Check system resources
free -h
```

### Models not loading
```bash
docker exec bg-remover-api ls -lh .onnx_cache/
docker-compose logs bg-remover | grep -i "model\|download"
```

## 📱 One-Liners

```bash
# Quick status check
curl -s http://localhost:5000/health | jq -r '.status'

# Current active jobs
curl -s http://localhost:5000/api/queue/stats | jq '.total_active'

# Current queue length
curl -s http://localhost:5000/api/queue/stats | jq '.total_queued'

# Memory percentage
curl -s http://localhost:5000/api/queue/stats | jq -r '.system.memory_percent'

# Is scaling enabled?
curl -s http://localhost:5000/api/queue/stats | jq -r '.dynamic_scaling.enabled'

# Current scaling boost
curl -s http://localhost:5000/api/queue/stats | jq -r '.dynamic_scaling.current_boost'

# Restart everything
docker-compose restart && docker-compose logs -f
```

## 📚 Help

```bash
# Docker Compose help
docker-compose --help
docker-compose logs --help

# Docker help
docker --help
docker exec --help

# Systemctl help
systemctl --help

# Get your server IP
curl ifconfig.me
```

---

**Tip**: Add these common commands to your `~/.bashrc` as aliases:

```bash
alias bghealth='curl -s http://localhost:5000/health | jq'
alias bgstats='curl -s http://localhost:5000/api/queue/stats | jq'
alias bglogs='docker-compose -f /opt/bg-remover/oracle-deploy/docker-compose.yml logs -f bg-remover'
alias bgrestart='cd /opt/bg-remover/oracle-deploy && docker-compose restart bg-remover'
```

Then reload: `source ~/.bashrc`

Now you can just type `bghealth`, `bgstats`, etc.!
