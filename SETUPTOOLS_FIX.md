# Fix pkg_resources Error

## The Problem
`ModuleNotFoundError: No module named 'pkg_resources'` - This is part of setuptools.

## Quick Fix

### 1. Install setuptools
```bash
# Install setuptools in virtual environment
pip install setuptools

# Or upgrade it
pip install --upgrade setuptools
```

### 2. Install all dependencies
```bash
# Make sure all dependencies are installed
pip install -r requirements.txt
pip install setuptools wheel
```

### 3. Test Gunicorn Again
```bash
cd ~/background-remover
source venv/bin/activate
gunicorn --workers 1 --bind 127.0.0.1:5001 server:app
```

### 4. If Still Fails - Reinstall Gunicorn
```bash
# Uninstall and reinstall gunicorn
pip uninstall gunicorn
pip install gunicorn

# Test again
gunicorn --workers 1 --bind 127.0.0.1:5001 server:app
```

### 5. Alternative: Use Flask Directly
If gunicorn keeps having issues, just use Flask:

```bash
sudo nano /etc/systemd/system/bgremover.service
```

Use this simple config:
```ini
[Unit]
Description=Background Remover Flask App
After=network.target

[Service]
User=root
WorkingDirectory=/root/background-remover
Environment=PATH=/root/background-remover/venv/bin
ExecStart=/root/background-remover/venv/bin/python server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl start bgremover
sudo systemctl status bgremover
```

### 6. Quick Test - Run Flask Now
```bash
cd ~/background-remover
source venv/bin/activate
nohup python server.py > app.log 2>&1 &

# Check if running
sudo netstat -tlnp | grep :5001

# Test
curl -I http://bgremover.sallulabs.com
```

## Why This Happens

- Python 3.12 sometimes has setuptools issues
- pkg_resources was moved in newer Python versions
- Virtual environment might not have all base packages

## Verify Everything Works

```bash
# Check Flask is running
sudo netstat -tlnp | grep :5001

# Test the app
curl -I http://bgremover.sallulabs.com

# Check nginx logs (should be clean)
sudo tail -10 /var/log/nginx/error.log
```

---

**Install setuptools first, then test gunicorn. If it still fails, just use Flask directly - it works perfectly!** 🚀
