# Digital Ocean Deployment Guide

Complete guide to deploy your Background Remover app on Digital Ocean.

## Prerequisites
- Digital Ocean account
- Domain name (optional, but recommended)
- Firebase credentials file
- SSH key set up

## Deployment Options

### Option 1: App Platform (Easiest - Recommended)
Digital Ocean's managed platform, similar to Heroku.

### Option 2: Droplet (More Control)
Your own virtual server with full control.

---

## 🚀 Option 1: App Platform Deployment (RECOMMENDED)

### Step 1: Prepare Your Repository

1. **Ensure these files exist in your repo**:
   - `requirements.txt` ✅ (already exists)
   - `server.py` ✅ (already exists)
   - `runtime.txt` (create below)

2. **Create `runtime.txt`** in your project root:
   ```
   python-3.11.0
   ```

3. **Update `requirements.txt`** to include gunicorn:
   ```txt
   # Add this line to requirements.txt
   gunicorn==21.2.0
   ```

4. **Create `Procfile`** (already exists ✅):
   ```
   web: gunicorn --worker-class=sync --workers=4 --timeout=120 --bind=0.0.0.0:$PORT server:app
   ```

### Step 2: Push to GitHub
```bash
git add .
git commit -m "Prepare for Digital Ocean deployment"
git push origin main
```

### Step 3: Deploy on App Platform

1. **Go to Digital Ocean Dashboard**:
   - Visit: https://cloud.digitalocean.com/apps

2. **Create New App**:
   - Click **Create App**
   - Choose **GitHub** as source
   - Select your repository
   - Select branch: `main`

3. **Configure App**:
   - **Name**: `background-remover`
   - **Region**: Choose closest to your users
   - **Plan**: Start with **Basic ($5/month)**
   
4. **Set Environment Variables**:
   Click **Edit** next to Environment Variables and add:
   ```
   SECRET_KEY=your-random-secret-key-change-this
   MAX_WORKERS=4
   MODEL_NAME=u2net
   FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
   ```

5. **Add Firebase Credentials**:
   - Copy the entire content of your `firebase-credentials.json`
   - Add as environment variable:
     ```
     FIREBASE_CREDENTIALS_JSON=<paste entire JSON here>
     ```
   - We'll modify the code to read from this variable

6. **Configure Build & Run**:
   - Build Command: `pip install -r requirements.txt`
   - Run Command: `gunicorn --worker-class=sync --workers=4 --timeout=120 --bind=0.0.0.0:$PORT server:app`

7. **Click Create Resources** and wait for deployment!

### Step 4: Update Code for App Platform

You need to modify `server.py` to read Firebase credentials from environment variable:

---

## 🖥️ Option 2: Droplet Deployment (Full Control)

### Step 1: Create Droplet

1. **Go to Digital Ocean**:
   - Visit: https://cloud.digitalocean.com/droplets

2. **Create Droplet**:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic ($12/month recommended for this app)
   - **CPU**: Regular Intel with SSD
   - **Size**: 2 GB RAM / 1 vCPU minimum
   - **Datacenter**: Choose closest to users
   - **Authentication**: SSH Key (recommended)
   - **Hostname**: `bg-remover`

3. **Click Create Droplet**

### Step 2: Connect to Droplet

```bash
ssh root@your_droplet_ip
```

### Step 3: Install Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Python and essentials
apt install -y python3.11 python3.11-venv python3-pip nginx git

# Install system dependencies for image processing
apt install -y libgl1-mesa-glx libglib2.0-0
```

### Step 4: Set Up Application

```bash
# Create app directory
mkdir -p /var/www/background-remover
cd /var/www/background-remover

# Clone your repository (use your actual repo URL)
git clone https://github.com/yourusername/background-remover.git .

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn
```

### Step 5: Configure Firebase

```bash
# Create firebase credentials file
nano firebase-credentials.json
# Paste your Firebase credentials JSON, then save (Ctrl+X, Y, Enter)

# Create .env file
nano .env
```

Paste this into `.env`:
```env
SECRET_KEY=your-super-secret-random-key-change-this
MAX_WORKERS=4
MODEL_NAME=u2net
FIREBASE_CREDENTIALS_PATH=/var/www/background-remover/firebase-credentials.json
FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
```

Save and exit (Ctrl+X, Y, Enter)

### Step 6: Create Systemd Service

```bash
nano /etc/systemd/system/background-remover.service
```

Paste this:
```ini
[Unit]
Description=Background Remover Flask App
After=network.target

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/var/www/background-remover
Environment="PATH=/var/www/background-remover/venv/bin"
ExecStart=/var/www/background-remover/venv/bin/gunicorn --workers 4 --bind unix:background-remover.sock --timeout 120 server:app
Restart=always

[Install]
WantedBy=multi-user.target
```

### Step 7: Configure Nginx

```bash
nano /etc/nginx/sites-available/background-remover
```

Paste this:
```nginx
server {
    listen 80;
    server_name your_domain.com;  # Change this to your domain or droplet IP

    client_max_body_size 20M;

    location / {
        include proxy_params;
        proxy_pass http://unix:/var/www/background-remover/background-remover.sock;
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
        proxy_send_timeout 180s;
    }

    location /static {
        alias /var/www/background-remover/static;
        expires 30d;
    }
}
```

Enable the site:
```bash
ln -s /etc/nginx/sites-available/background-remover /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Step 8: Set Permissions

```bash
chown -R www-data:www-data /var/www/background-remover
chmod -R 755 /var/www/background-remover
```

### Step 9: Start Service

```bash
systemctl daemon-reload
systemctl start background-remover
systemctl enable background-remover
systemctl status background-remover
```

### Step 10: Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### Step 11: Set Up SSL (Optional but Recommended)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your_domain.com
```

---

## 🔧 Post-Deployment

### Check Application Status
```bash
# Check service status
systemctl status background-remover

# View logs
journalctl -u background-remover -f

# Check Nginx
systemctl status nginx
```

### Update Application
```bash
cd /var/www/background-remover
git pull origin main
source venv/bin/activate
pip install -r requirements.txt
systemctl restart background-remover
```

### Monitor Resources
```bash
# Check memory and CPU
htop

# Check disk space
df -h

# Check app logs
tail -f /var/log/nginx/error.log
```

---

## 💰 Pricing Comparison

| Service | Price/Month | RAM | CPU | Notes |
|---------|-------------|-----|-----|-------|
| App Platform Basic | $5 | 512MB | Shared | Limited for ML models |
| App Platform Pro | $12 | 1GB | Shared | Minimum recommended |
| Droplet Basic | $12 | 2GB | 1 vCPU | Best value |
| Droplet Standard | $24 | 4GB | 2 vCPU | Better performance |

**Recommendation**: Start with **$12 Droplet** (2GB RAM) for best control and performance.

---

## 🐛 Troubleshooting

### App won't start
```bash
# Check logs
journalctl -u background-remover -n 50

# Check if port is in use
netstat -tulpn | grep 5000

# Restart service
systemctl restart background-remover
```

### Out of memory
```bash
# Check memory
free -h

# Add swap space (4GB)
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Firebase errors
```bash
# Verify credentials file exists
ls -la /var/www/background-remover/firebase-credentials.json

# Check if service can read it
sudo -u www-data cat firebase-credentials.json
```

### Nginx errors
```bash
# Test configuration
nginx -t

# Check error logs
tail -f /var/log/nginx/error.log

# Restart nginx
systemctl restart nginx
```

---

## 📊 Performance Optimization

### 1. Enable Gzip Compression
Add to Nginx config:
```nginx
gzip on;
gzip_types text/css application/javascript image/svg+xml;
gzip_min_length 1000;
```

### 2. Adjust Worker Count
For 2GB RAM:
```env
MAX_WORKERS=4
```

For 4GB RAM:
```env
MAX_WORKERS=8
```

### 3. Use CDN for Static Files
- Upload static files to Digital Ocean Spaces
- Update references in templates

---

## 🔒 Security Best Practices

1. **Use Environment Variables** for secrets
2. **Enable SSL** with Let's Encrypt (free)
3. **Set up firewall** (UFW)
4. **Regular updates**: `apt update && apt upgrade`
5. **Monitor logs** for suspicious activity
6. **Use strong SSH keys** (disable password login)

---

## Need Help?

- Digital Ocean Docs: https://docs.digitalocean.com/
- Community: https://www.digitalocean.com/community
- Your app logs: `journalctl -u background-remover -f`
