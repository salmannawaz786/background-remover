# Pre-Deployment Checklist ✅

Complete this checklist before deploying to Oracle Cloud.

## 1. Oracle Cloud Instance Setup

- [ ] Created Oracle Cloud account
- [ ] Provisioned VM instance:
  - [ ] Shape: 24GB RAM, 4 vCPUs (e.g., VM.Standard.E2.4 or custom ARM)
  - [ ] OS: Ubuntu 22.04
  - [ ] Boot volume: 100GB minimum
  - [ ] Public IP assigned
- [ ] Security List configured:
  - [ ] Port 22 (SSH) - open
  - [ ] Port 80 (HTTP) - open
  - [ ] Port 443 (HTTPS) - open
- [ ] Can SSH into instance: `ssh ubuntu@YOUR_SERVER_IP`

## 2. Firebase Setup

- [ ] Created Firebase project at https://console.firebase.google.com
- [ ] Enabled Authentication → Sign-in method → Email/Password
- [ ] Generated Service Account Key:
  - [ ] Go to Project Settings → Service Accounts
  - [ ] Click "Generate New Private Key"
  - [ ] Downloaded JSON file
- [ ] Have Firebase Web App credentials:
  - [ ] API Key
  - [ ] Auth Domain
  - [ ] Project ID
  - [ ] Storage Bucket
  - [ ] Messaging Sender ID
  - [ ] App ID
  - [ ] Measurement ID

## 3. Cloudflare R2 Setup

- [ ] Have Cloudflare account
- [ ] Created R2 bucket at https://dash.cloudflare.com/r2
- [ ] Generated R2 API tokens:
  - [ ] Access Key ID
  - [ ] Secret Access Key
- [ ] Have R2 endpoint URL
- [ ] (Optional) Configured custom domain for R2 bucket

## 4. Vercel Frontend Setup

- [ ] Frontend deployed to Vercel
- [ ] Have Vercel deployment URL(s):
  - [ ] Production: `https://your-app.vercel.app`
  - [ ] Preview: `https://your-app-git-*.vercel.app` (if needed)

## 5. Local Preparation

- [ ] All code committed to git
- [ ] Pushed to GitHub/GitLab
- [ ] ONNX models exist in `.onnx_cache/` folder:
  - [ ] `opt_u2netp.onnx` (~4MB)
  - [ ] `rvm.onnx` (~15MB)
  - [ ] `model_fp16.onnx` or BiRefNet model (~98MB)
- [ ] Have this repository URL

## 6. Credentials Ready

Prepare these values for the `.env` file:

### Firebase
```
FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef
FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

### Cloudflare R2
```
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com
R2_ACCESS_KEY=your_access_key_id
R2_SECRET_KEY=your_secret_access_key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_DOMAIN=https://cdn.yourdomain.com (optional)
```

### CORS Origins
```
EXTRA_ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://preview.vercel.app
```

### Secret Key
Generate with: `openssl rand -hex 32`
```
SECRET_KEY=your_generated_secret_key
```

## 7. Deployment Files Check

On your local machine, verify these files exist:

```bash
cd background-remover

# Core files
ls server.py                    # Main Flask server
ls model_manager_v4.py          # Model manager
ls queue_manager.py             # Queue system (NEW)
ls requirements.txt             # Python dependencies

# Deployment files
ls Dockerfile.production        # Production Docker image
ls oracle-deploy/docker-compose.yml
ls oracle-deploy/nginx.conf
ls oracle-deploy/setup-oracle.sh
ls oracle-deploy/deploy.sh
ls oracle-deploy/.env.example
```

All files should be present. If any are missing, check git status.

## 8. Pre-Deploy Commands

Before deploying, test locally if possible:

```bash
# Test queue manager
python -c "from queue_manager import get_queue_manager; qm = get_queue_manager(); print(qm.get_queue_stats())"

# Test model manager
python -c "from model_manager_v4 import get_model_manager; m = get_model_manager()"

# Check requirements
pip install -r requirements.txt
```

## 🚀 Ready to Deploy?

If all checkboxes are checked, you're ready!

### Quick Deploy Commands:

```bash
# 1. SSH into Oracle instance
ssh ubuntu@YOUR_SERVER_IP

# 2. Clone repository
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy

# 3. Run setup
sudo chmod +x setup-oracle.sh
sudo ./setup-oracle.sh

# 4. Configure environment
cd /opt/bg-remover/oracle-deploy
cp .env.example .env
nano .env  # Fill in all your credentials

# 5. Deploy!
chmod +x deploy.sh
./deploy.sh
```

### Post-Deploy Verification:

```bash
# Health check
curl http://localhost:5000/health

# Queue stats
curl http://localhost:5000/api/queue/stats

# View logs
docker-compose logs -f bg-remover

# Test upload (replace with your frontend URL)
# Visit your Vercel frontend and test uploading an image
```

### Update Frontend:

On Vercel, set environment variable:
```
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP
```

Then redeploy:
```bash
vercel --prod
```

## 📞 Need Help?

- Setup issues: Check `docker-compose logs -f`
- Queue issues: Check `curl http://localhost:5000/api/queue/stats`
- Model issues: Check logs for "model" or "download"
- Memory issues: Run `free -h` and `docker stats`

See [README.md](README.md) for detailed troubleshooting.

---

**Good luck with your deployment! 🚀**
