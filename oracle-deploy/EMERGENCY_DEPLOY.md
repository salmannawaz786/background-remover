# Emergency Deployment - Skip Docker (It's Stuck!)

Your Docker build has been stuck at Step 9/26 for 30 minutes. Let's deploy **without Docker** - it's faster and simpler for initial setup.

---

## 🚨 What to Do Right Now

### Step 1: Stop the Docker Build

In your SSH terminal on the Oracle server:

```bash
# Press Ctrl+C to stop the Docker build
# If it doesn't stop, press Ctrl+C again
```

### Step 2: Install Python Dependencies Directly

```bash
cd /opt/bg-remover

# Install system packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv libgl1 libglib2.0-0

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install Python packages (this will be faster than Docker's multi-stage copy)
pip install --upgrade pip
pip install -r requirements.txt
```

**Note**: This step might take 10-15 minutes (installing PyTorch, etc.) but you'll see actual progress, not a stuck screen.

---

### Step 3: Configure Environment Variables

```bash
cd /opt/bg-remover

# Copy the example env file
cp oracle-deploy/.env.example .env

# Edit the .env file with your credentials
nano .env
```

**Required values to add** (press Ctrl+O to save, Ctrl+X to exit):

```bash
SECRET_KEY=your-random-secret-key-here

# Firebase (get from your Firebase Console)
FIREBASE_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project"}
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef

# R2 Storage (get from Cloudflare R2 dashboard)
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY=your-access-key
R2_SECRET_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_DOMAIN=https://your-cdn.com

# Your server IP
APP_URL=http://141.253.199.23
EXTRA_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

---

### Step 4: Start the Server

```bash
cd /opt/bg-remover
source venv/bin/activate  # If not already activated

# Run with Gunicorn (production-ready)
gunicorn --workers 3 \
         --threads 2 \
         --worker-class gthread \
         --timeout 120 \
         --bind 0.0.0.0:5000 \
         --access-logfile - \
         --error-logfile - \
         server:app
```

**You should see**:
```
[INFO] Starting gunicorn 20.1.0
[INFO] Listening at: http://0.0.0.0:5000
[INFO] Using worker: gthread
[INFO] Booting worker with pid: 1234
[INFO] Initializing background remover...
[INFO] RVM (persons) loaded
[INFO] U2Net-P (fast objects) loaded
[INFO] Smart queue manager initialized
```

---

### Step 5: Test the API

**Open a NEW terminal on your Windows machine** (keep the server running):

```powershell
# Test health endpoint
curl http://141.253.199.23:5000/health

# Test queue stats
curl http://141.253.199.23:5000/api/queue/stats
```

**Expected response**:
```json
{
  "status": "healthy",
  "models": {...},
  "memory_usage": "15%",
  "queue": {
    "bg_fast": {...},
    "bg_pro": {...}
  }
}
```

---

## ✅ If Everything Works

1. **Keep the server running** in background:

```bash
# Stop the current server (Ctrl+C)

# Install screen (if not installed)
sudo apt-get install -y screen

# Start in screen session (runs in background)
screen -S bg-remover

# Run the server
cd /opt/bg-remover
source venv/bin/activate
gunicorn --workers 3 --threads 2 --worker-class gthread --timeout 120 --bind 0.0.0.0:5000 server:app

# Press Ctrl+A then D to detach (server keeps running)
```

2. **Update your Vercel frontend** with the API URL:
   - Go to your Vercel project settings
   - Add environment variable: `NEXT_PUBLIC_API_URL=http://141.253.199.23:5000`
   - Redeploy

3. **Test from frontend**: Upload an image and see if it processes!

---

## 🔧 Troubleshooting

### "ModuleNotFoundError: No module named 'X'"

```bash
source venv/bin/activate
pip install -r requirements.txt
```

### "Port 5000 is already in use"

```bash
# Kill the process using port 5000
sudo lsof -ti:5000 | xargs sudo kill -9

# Or use a different port
gunicorn --bind 0.0.0.0:8000 server:app
```

### "Connection refused" from Windows

Check Oracle Cloud firewall (you already did this, but verify):

1. Go to Oracle Cloud Console
2. Networking → Virtual Cloud Networks → Your VCN
3. Security Lists → Default Security List
4. Verify Ingress Rules:
   - 0.0.0.0/0 → Port 5000 (TCP)
   - 0.0.0.0/0 → Port 80 (TCP)
   - 0.0.0.0/0 → Port 443 (TCP)

Also check Ubuntu firewall:

```bash
# Check if ufw is active
sudo ufw status

# If active, allow port 5000
sudo ufw allow 5000/tcp
```

---

## 📝 Why Docker Got Stuck

Docker's `COPY --from=builder` step was copying several GB of Python packages. The Oracle Cloud Always Free instance has:
- 4 vCPUs (shared)
- Limited I/O bandwidth
- Network throttling

This can make large Docker copies extremely slow. Running directly with Python is **faster and simpler** for now. You can always containerize later once it's working.

---

## 🎯 Next Steps After Server is Running

1. Set up SSL certificate with Let's Encrypt (optional but recommended)
2. Configure Nginx as reverse proxy (improves performance)
3. Set up systemd service (auto-start on reboot)
4. Configure log rotation
5. Set up monitoring (optional)

For now, **focus on getting it working!** We can improve the setup later.

---

## 📞 Need Help?

If you see errors, copy the EXACT error message and share it. That helps me diagnose the issue quickly!
