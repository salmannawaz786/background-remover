#!/bin/bash
set -e

echo "========================================="
echo "Background Remover - Oracle Cloud Setup"
echo "========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root (use sudo)${NC}" 
   exit 1
fi

echo -e "${GREEN}[1/8] Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

echo -e "${GREEN}[2/8] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}Docker installed successfully${NC}"
else
    echo -e "${YELLOW}Docker already installed${NC}"
fi

echo -e "${GREEN}[3/8] Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}Docker Compose installed successfully${NC}"
else
    echo -e "${YELLOW}Docker Compose already installed${NC}"
fi

echo -e "${GREEN}[4/8] Configuring firewall...${NC}"
# Oracle Cloud uses iptables, configure necessary ports
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
netfilter-persistent save 2>/dev/null || iptables-save > /etc/iptables/rules.v4

echo -e "${GREEN}[5/8] Optimizing system for AI workloads (24GB RAM / 4 vCPUs)...${NC}"

# Swappiness
echo "vm.swappiness=10" >> /etc/sysctl.conf

# File descriptors
echo "fs.file-max = 65536" >> /etc/sysctl.conf

# Network optimizations
cat >> /etc/sysctl.conf <<EOF
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 1024 65535
EOF

sysctl -p

echo -e "${GREEN}[6/8] Setting up application directory...${NC}"
APP_DIR="/opt/bg-remover"
mkdir -p $APP_DIR
cd $APP_DIR

echo -e "${GREEN}[7/8] Setting up environment file...${NC}"
if [ ! -f .env ]; then
    cat > .env <<EOF
# Flask
PORT=5000
WORKERS=4
MAX_REQUESTS=1000
MAX_REQUESTS_JITTER=100
SECRET_KEY=$(openssl rand -hex 32)

# Firebase (replace with your values)
FIREBASE_CREDENTIALS_JSON=
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
FIREBASE_MEASUREMENT_ID=

# Cloudflare R2 (replace with your values)
R2_ENDPOINT=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_DOMAIN=

# CORS - Add your Vercel frontend URL
EXTRA_ALLOWED_ORIGINS=https://your-frontend.vercel.app

# App URL
APP_URL=http://$(curl -s ifconfig.me)
EOF
    echo -e "${YELLOW}Please edit .env file with your credentials: nano .env${NC}"
fi

echo -e "${GREEN}[8/8] Creating systemd service for auto-start...${NC}"
cat > /etc/systemd/system/bg-remover.service <<EOF
[Unit]
Description=Background Remover API
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bg-remover.service

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Setup completed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy your application files to: $APP_DIR"
echo "2. Edit environment variables: nano $APP_DIR/.env"
echo "3. Start the application: cd $APP_DIR && docker-compose up -d"
echo "4. Check status: docker-compose ps"
echo "5. View logs: docker-compose logs -f bg-remover"
echo "6. Your server IP: $(curl -s ifconfig.me)"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  systemctl status bg-remover  - Check service status"
echo "  docker-compose restart       - Restart services"
echo "  docker-compose down          - Stop services"
echo "  docker-compose logs -f       - View live logs"
echo ""
