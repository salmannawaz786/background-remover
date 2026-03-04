# Fix 403 Forbidden for Static Files

## The Problem
Nginx is returning 403 Forbidden for all static files (CSS, JS, images).

## Solution 1: Fix File Permissions

```bash
# Fix permissions for static files
sudo chmod -R 755 /root/background-remover/static/
sudo chmod -R 755 /root/background-remover/templates/

# Fix ownership
sudo chown -R root:root /root/background-remover/static/
sudo chown -R root:root /root/background-remover/templates/
```

## Solution 2: Update Nginx Config

```bash
sudo nano /etc/nginx/sites-available/bgremover
```

Add static file serving:

```nginx
server {
    listen 80;
    server_name bgremover.sallulabs.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Upload limit
    client_max_body_size 15M;

    # Serve static files directly (better performance)
    location /static {
        alias /root/background-remover/static;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri $uri/ =404;
    }

    # Proxy to Flask app for dynamic content
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Solution 3: Create www-data User Access (Recommended)

```bash
# Add www-data to root group (or create a dedicated user)
sudo usermod -a -G root www-data

# Make static files readable by www-data
sudo chmod -R 755 /root/background-remover/static/
sudo chmod -R 755 /root/background-remover/templates/

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Solution 4: Use Flask for Static Files (Easiest)

Update nginx to let Flask handle everything:

```nginx
server {
    listen 80;
    server_name bgremover.sallulabs.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Upload limit
    client_max_body_size 15M;

    # Proxy everything to Flask (including static files)
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Solution 5: Move Files to Web-Accessible Directory

```bash
# Create web directory
sudo mkdir -p /var/www/bgremover/static
sudo mkdir -p /var/www/bgremover/templates

# Copy files
sudo cp -r /root/background-remover/static/* /var/www/bgremover/static/
sudo cp -r /root/background-remover/templates/* /var/www/bgremover/templates/

# Set permissions
sudo chown -R www-data:www-data /var/www/bgremover/
sudo chmod -R 755 /var/www/bgremover/

# Update nginx config
sudo nano /etc/nginx/sites-available/bgremover
```

Use this config:
```nginx
server {
    listen 80;
    server_name bgremover.sallulabs.com;

    # Static files
    location /static {
        alias /var/www/bgremover/static;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Templates
    location /templates {
        alias /var/www/bgremover/templates;
    }

    # Flask app
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Test the Fix

```bash
# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Clear browser cache and test
curl -I http://bgremover.sallulabs.com/static/theme.css
```

## Quick Fix (Try This First)

```bash
# Fix permissions
sudo chmod -R 755 /root/background-remover/static/
sudo chmod -R 755 /root/background-remover/templates/

# Let Flask handle static files (update nginx)
sudo nano /etc/nginx/sites-available/bgremover
```

Replace content with:
```nginx
server {
    listen 80;
    server_name bgremover.sallulabs.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Upload limit
    client_max_body_size 15M;

    # Proxy everything to Flask
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

**Try the Quick Fix first - Flask can serve static files perfectly!** 🚀
