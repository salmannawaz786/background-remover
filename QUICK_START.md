# 🚀 Quick Start Guide

## Fix Firebase Cross-Project Access (Do This First!)

Your Firebase setup is almost correct, you just need to grant permissions:

### 1. Grant Cross-Project Access

Go to Google Cloud Console:
1. Visit: https://console.cloud.google.com/storage/browser
2. **Switch to project**: `imagetotext-4c3e3` (the bucket project)
3. Click on bucket: `imagetotext-4c3e3.appspot.com`
4. Click **Permissions** tab
5. Click **+ GRANT ACCESS**
6. Paste this email:
   ```
   firebase-adminsdk-m8i9d@are-you-genius-1f253.iam.gserviceaccount.com
   ```
7. Select role: **Storage Object Admin**
8. Click **SAVE**

### 2. Create `.env` File

```bash
cp .env.example .env
```

Edit `.env` with these values:
```env
SECRET_KEY=your-super-secret-random-key
MAX_WORKERS=8
MODEL_NAME=u2net
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
```

### 3. Test Locally

```bash
python server.py
```

Upload an image - you should NOT see 403 errors anymore! ✅

---

## 🌊 Deploy to Digital Ocean

### Option A: App Platform (Easiest)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push
   ```

2. **Go to Digital Ocean**:
   - Visit: https://cloud.digitalocean.com/apps
   - Click **Create App**
   - Connect GitHub repo
   - Select your repository

3. **Configure**:
   - Build: `pip install -r requirements.txt`
   - Run: `gunicorn --workers 4 --timeout 120 --bind 0.0.0.0:$PORT server:app`

4. **Add Environment Variables**:
   ```
   SECRET_KEY=your-secret-key
   MAX_WORKERS=4
   MODEL_NAME=u2net
   FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
   FIREBASE_CREDENTIALS_JSON=<paste your entire firebase-credentials.json content>
   ```

5. **Deploy!** 🚀

### Option B: Droplet (More Control)

1. **Create Droplet**:
   - Ubuntu 22.04 LTS
   - 2GB RAM minimum ($12/month)
   - Add SSH key

2. **Connect**:
   ```bash
   ssh root@your_droplet_ip
   ```

3. **Run Deployment Script**:
   ```bash
   # Download the script
   wget https://raw.githubusercontent.com/yourusername/background-remover/main/deploy-digitalocean.sh
   
   # Or if you have the file, upload it:
   scp deploy-digitalocean.sh root@your_droplet_ip:/root/
   
   # Run it
   chmod +x deploy-digitalocean.sh
   sudo bash deploy-digitalocean.sh
   ```

4. **Follow the prompts** - the script will:
   - Install all dependencies
   - Clone your repo
   - Set up Python environment
   - Configure Nginx
   - Create systemd service
   - Start your app

---

## 📝 What Changed

### Performance Fixes ✅
- Added timeout to Firebase uploads (10s max)
- Failed uploads no longer block response
- Users get images immediately (~12s instead of 30s+)

### Dark Mode Fixes ✅
- Changed "FREE" tag from yellow to pink
- Fixed "try now" tags color in dark mode
- Fixed contact details color

### Deployment Ready ✅
- Added `gunicorn` to requirements
- Created `runtime.txt` for Python version
- Updated `server.py` to support env variable credentials
- Created automated deployment script

---

## 📚 Full Documentation

- **Firebase Setup**: `FIREBASE_FIX_GUIDE.md`
- **Digital Ocean**: `DIGITALOCEAN_DEPLOYMENT.md`
- **Troubleshooting**: See deployment guides

---

## 🆘 Need Help?

### Check Service Status
```bash
sudo systemctl status background-remover
```

### View Logs
```bash
sudo journalctl -u background-remover -f
```

### Restart App
```bash
sudo systemctl restart background-remover
```

### Update App
```bash
cd /var/www/background-remover
git pull
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart background-remover
```
