# Troubleshooting - Site Can't Be Reached

## Step 1: Check if Flask App is Running

```bash
# Check if anything is running on port 5001
sudo netstat -tlnp | grep :5001

# If nothing shows, start the app:
cd ~/background-remover
source venv/bin/activate
python server.py
```

## Step 2: Test Flask App Directly

```bash
# Test Flask app directly (bypass nginx)
curl -I http://localhost:5001
curl -I http://127.0.0.1:5001

# If this works, Flask is running but nginx has issues
```

## Step 3: Check Nginx Configuration

```bash
# Check which sites are enabled
ls -la /etc/nginx/sites-enabled/

# Should only show: bgremover -> ../sites-available/bgremover

# Check nginx config
sudo nginx -t

# Check nginx error log
sudo tail -20 /var/log/nginx/error.log

# Check nginx access log
sudo tail -20 /var/log/nginx/access.log
```

## Step 4: Check Firewall

```bash
# Check firewall status
sudo ufw status

# Allow nginx if not already
sudo ufw allow 'Nginx Full'
sudo ufw allow ssh
sudo ufw reload

# Check if port 80 is open
sudo netstat -tlnp | grep :80
```

## Step 5: Test Nginx Directly

```bash
# Test nginx with a simple request
curl -v http://localhost
curl -v http://bgremover.sallulabs.com

# Test nginx proxy
curl -v http://localhost/proxy-test
```

## Step 6: Fix Common Issues

### Issue 1: Default site still enabled
```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl reload nginx
```

### Issue 2: Wrong server name
```bash
sudo nano /etc/nginx/sites-available/bgremover
```
Make sure it says:
```nginx
server_name bgremover.sallulabs.com;
```

### Issue 3: Flask app not binding correctly
Check your server.py - it should bind to:
```python
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001, debug=False)
```

## Step 7: Complete Restart Sequence

```bash
# 1. Stop everything
sudo systemctl stop nginx
pkill -f "python server.py"
pkill -f gunicorn

# 2. Start Flask app
cd ~/background-remover
source venv/bin/activate
nohup python server.py > app.log 2>&1 &

# 3. Check if Flask is running
sudo netstat -tlnp | grep :5001

# 4. Start nginx
sudo systemctl start nginx
sudo systemctl status nginx

# 5. Test
curl -I http://bgremover.sallulabs.com
```

## Step 8: Use Gunicorn (Production Ready)

```bash
# Install gunicorn
pip install gunicorn

# Create service file
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

# Restart nginx
sudo systemctl restart nginx
```

## Step 9: Final Test

```bash
# Test locally
curl -I http://localhost:5001
curl -I http://localhost

# Test externally
curl -I http://bgremover.sallulabs.com

# Check logs
tail -f ~/background-remover/app.log
sudo tail -f /var/log/nginx/error.log
```

## Debug Commands

```bash
# Check all processes
ps aux | grep -E "(nginx|python|gunicorn)"

# Check all ports
sudo netstat -tlnp

# Check nginx config syntax
sudo nginx -t

# Test DNS resolution
nslookup bgremover.sallulabs.com
dig bgremover.sallulabs.com
```

---

**Run these commands in order to identify where the issue is!** 🚀
