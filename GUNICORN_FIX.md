# Fix Gunicorn Service

## The Problem
Gunicorn service is failing with exit-code 1 and restarting too quickly.

## Debug Gunicorn

### 1. Check Gunicorn Error
```bash
# Check the detailed error
sudo journalctl -u bgremover.service -n 20

# Or check status with more detail
sudo systemctl status bgremover.service --no-pager
```

### 2. Test Gunicorn Manually
```bash
# Try running gunicorn manually to see the error
cd ~/background-remover
source venv/bin/activate
gunicorn --workers 3 --bind 127.0.0.1:5001 server:app
```

### 3. Common Fixes

#### Fix 1: Update Service File
```bash
sudo nano /etc/systemd/system/bgremover.service
```

Update to this:
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
ExecStart=/root/background-remover/venv/bin/gunicorn --workers 1 --bind 127.0.0.1:5001 server:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### Fix 2: Use Simple Command
```bash
# Update the ExecStart line to use full path
ExecStart=/root/background-remover/venv/bin/python /root/background-remover/server.py
```

#### Fix 3: Check Flask App
Make sure your server.py has this at the end:
```python
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001, debug=False)
```

And add this for Gunicorn:
```python
# At the bottom of server.py
app = app  # Make sure app is available for Gunicorn
```

### 4. Restart Service
```bash
sudo systemctl daemon-reload
sudo systemctl start bgremover
sudo systemctl status bgremover
```

### 5. Alternative: Use Flask Directly
If Gunicorn keeps failing, use Flask directly:

```bash
sudo nano /etc/systemd/system/bgremover.service
```

Use this config:
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

### 6. Quick Test - Run Flask in Background
If service keeps failing, just run Flask in background:

```bash
cd ~/background-remover
source venv/bin/activate
nohup python server.py > app.log 2>&1 &

# Check if running
sudo netstat -tlnp | grep :5001

# Test
curl -I http://bgremover.sallulabs.com
```

### 7. Check Logs
```bash
# Check Flask logs
tail -f app.log

# Check systemd logs
sudo journalctl -u bgremover.service -f
```

## Most Likely Issues

1. **Missing gunicorn**: `pip install gunicorn`
2. **Wrong Flask app name**: Should be `server:app` not `server:flask_app`
3. **Python path issues**: Use full paths in service file
4. **Flask app not ready for Gunicorn**: Need proper WSGI entry point

---

**Try the manual gunicorn command first to see the exact error!** 🚀
