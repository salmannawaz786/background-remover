#!/bin/bash
# Digital Ocean Droplet Deployment Script
# Run this script on your droplet after initial setup

set -e  # Exit on error

echo "🚀 Starting Background Remover Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/var/www/background-remover"
APP_USER="www-data"
SERVICE_NAME="background-remover"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root (use: sudo bash deploy-digitalocean.sh)${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Updating system packages...${NC}"
apt update && apt upgrade -y

echo -e "${YELLOW}Step 2: Installing dependencies...${NC}"
apt install -y python3.11 python3.11-venv python3-pip nginx git libgl1-mesa-glx libglib2.0-0

echo -e "${YELLOW}Step 3: Setting up application directory...${NC}"
mkdir -p $APP_DIR
cd $APP_DIR

# If git repo not cloned yet
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}Enter your GitHub repository URL:${NC}"
    read REPO_URL
    git clone $REPO_URL .
else
    echo -e "${GREEN}Git repository already exists, pulling latest changes...${NC}"
    git pull origin main
fi

echo -e "${YELLOW}Step 4: Setting up Python virtual environment...${NC}"
python3.11 -m venv venv
source venv/bin/activate

echo -e "${YELLOW}Step 5: Installing Python dependencies...${NC}"
pip install --upgrade pip
pip install -r requirements.txt

echo -e "${YELLOW}Step 6: Setting up Firebase credentials...${NC}"
if [ ! -f "firebase-credentials.json" ]; then
    echo -e "${RED}firebase-credentials.json not found!${NC}"
    echo -e "${YELLOW}Please create it now. Paste your Firebase JSON credentials and press Ctrl+D when done:${NC}"
    cat > firebase-credentials.json
fi

echo -e "${YELLOW}Step 7: Creating .env file...${NC}"
if [ ! -f ".env" ]; then
    cat > .env << 'EOL'
SECRET_KEY=change-this-to-a-random-secret-key
MAX_WORKERS=4
MODEL_NAME=u2net
FIREBASE_CREDENTIALS_PATH=/var/www/background-remover/firebase-credentials.json
FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
EOL
    echo -e "${YELLOW}Please edit .env file and set your configuration:${NC}"
    echo "nano .env"
    read -p "Press Enter when done..."
fi

echo -e "${YELLOW}Step 8: Creating systemd service...${NC}"
cat > /etc/systemd/system/$SERVICE_NAME.service << EOL
[Unit]
Description=Background Remover Flask App
After=network.target

[Service]
Type=notify
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin"
ExecStart=$APP_DIR/venv/bin/gunicorn --workers 4 --bind unix:$APP_DIR/background-remover.sock --timeout 120 server:app
Restart=always

[Install]
WantedBy=multi-user.target
EOL

echo -e "${YELLOW}Step 9: Configuring Nginx...${NC}"
echo -e "${YELLOW}Enter your domain name (or press Enter to use Droplet IP):${NC}"
read DOMAIN_NAME

if [ -z "$DOMAIN_NAME" ]; then
    DOMAIN_NAME="_"
fi

cat > /etc/nginx/sites-available/$SERVICE_NAME << EOL
server {
    listen 80;
    server_name $DOMAIN_NAME;

    client_max_body_size 20M;

    location / {
        include proxy_params;
        proxy_pass http://unix:$APP_DIR/background-remover.sock;
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
        proxy_send_timeout 180s;
    }

    location /static {
        alias $APP_DIR/static;
        expires 30d;
    }
}
EOL

# Enable site
ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo -e "${YELLOW}Step 10: Setting permissions...${NC}"
chown -R $APP_USER:$APP_USER $APP_DIR
chmod -R 755 $APP_DIR

echo -e "${YELLOW}Step 11: Testing Nginx configuration...${NC}"
nginx -t

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Nginx configuration is valid!${NC}"
else
    echo -e "${RED}Nginx configuration has errors. Please fix them.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 12: Starting services...${NC}"
systemctl daemon-reload
systemctl restart nginx
systemctl restart $SERVICE_NAME
systemctl enable $SERVICE_NAME

echo -e "${YELLOW}Step 13: Configuring firewall...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
echo "y" | ufw enable

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "Your app should now be running!"
echo ""
echo "Check status with:"
echo "  sudo systemctl status $SERVICE_NAME"
echo ""
echo "View logs with:"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "Access your app at:"
if [ "$DOMAIN_NAME" = "_" ]; then
    echo "  http://$(curl -s http://checkip.amazonaws.com)/"
else
    echo "  http://$DOMAIN_NAME/"
fi
echo ""
echo -e "${YELLOW}⚠️  To set up SSL (HTTPS), run:${NC}"
echo "  sudo apt install certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d $DOMAIN_NAME"
