# Start Flask App - Fix Connection Refused

## The Problem
Nginx is working but Flask app is not running on port 5001.

## Quick Fix - Start Flask App

```bash
# 1. Go to your project directory
cd ~/background-remover

# 2. Activate virtual environment
source venv/bin/activate

# 3. Start the Flask app
python server.py
```

## Keep Flask Running in Background

```bash
# Start Flask app in background (so it keeps running after you logout)
nohup python server.py > app.log 2>&1 &

# Check if it's running
ps aux | grep "python server.py"

# Check if port 5001 is now listening
sudo netstat -tlnp | grep :5001
```

## Check Flask App Logs

```bash
# See Flask app output
tail -f app.log

# Or if running in foreground, you'll see logs directly
```

## Production Setup with Gunicorn (Recommended)

For production, use Gunicorn instead of running Flask directly:

```bash
# Install gunicorn
pip install gunicorn

# Create systemd service
sudo nano /etc/systemd/system/bgremover.service
```

Add this content:
```ini
[Unit]
Description=Background Remover Flask App
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=/root/background-remover
Environment=PATH=/root/background-remover/venv/bin
Environment=FLASK_ENV=production
ExecStart=/root/background-remover/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5001 server:app
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Start the service
sudo systemctl daemon-reload
sudo systemctl start bgremover
sudo systemctl enable bgremover
sudo systemctl status bgremover

# Check if port 5001 is listening
sudo netstat -tlnp | grep :5001
```

## Test Everything

```bash
# 1. Check Flask app is running
sudo netstat -tlnp | grep :5001

# 2. Test Flask app directly
curl -I http://localhost:5001

# 3. Test through nginx
curl -I http://bgremover.sallulabs.com

# 4. Check nginx error log (should be empty now)
sudo tail -f /var/log/nginx/error.log
```

## Common Issues

### If Flask app crashes on start:
```bash
# Check for missing dependencies
pip install -r requirements.txt

# Check for missing models
python -c "
from model_manager_v4 import RVM_CONFIG, RMBG_CONFIG, _download_model
_download_model(RVM_CONFIG['url'], RVM_CONFIG['file'], 'RVM')
_download_model(RMBG_CONFIG['url'], RMBG_CONFIG['file'], 'RMBG')
print('Models downloaded')
"
```

### If port 5001 is already in use:
```bash
# Kill any process using port 5001
sudo fuser -k 5001/tcp

# Then start your app
python server.py
```

### If you get permission errors:
```bash
# Make sure you're in the right directory
cd ~/background-remover

# Check file permissions
ls -la server.py

# Make sure virtual environment is activated
which python
# Should show: /root/background-remover/venv/bin/python
```

## Verify It's Working

After starting Flask app, you should see:
1. `sudo netstat -tlnp | grep :5001` shows port 5001 listening
2. `curl -I http://localhost:5001` returns 200 OK
3. `curl -I http://bgremover.sallulabs.com` returns your app
4. Nginx error log stops showing "Connection refused"

---

**The Flask app needs to be running for nginx to proxy to it! Start it now and your site will work.** 🚀
