# SSL Certificate for Subdomain

## With Certbot (Recommended)

```bash
# Get SSL for your subdomain
sudo certbot --nginx -d bgremover.sallulabs.com

# If you also want the main domain (optional)
sudo certbot --nginx -d sallulabs.com -d bgremover.sallulabs.com

# If you want both www and subdomain
sudo certbot --nginx -d sallulabs.com -d www.sallulabs.com -d bgremover.sallulabs.com
```

## Update Nginx Config

Edit your nginx config to use the subdomain:

```bash
sudo nano /etc/nginx/sites-available/bgremover
```

Update the server_name line:

```nginx
server {
    listen 80;
    server_name bgremover.sallulabs.com;

    # Rest of your config...
    # Security headers, proxy settings, etc.
}
```

## After Certbot

Certbot will automatically:
1. Update your nginx config to include SSL
2. Create the certificate files
3. Set up auto-renewal
4. Redirect HTTP to HTTPS

Your config will look like this after certbot:

```nginx
server {
    server_name bgremover.sallulabs.com;
    root /var/www/html;
    index index.html index.htm;

    # SSL configuration (added by certbot)
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/bgremover.sallulabs.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/bgremover.sallulabs.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Upload limit
    client_max_body_size 15M;

    # Proxy to Flask app
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    if ($host = bgremover.sallulabs.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name bgremover.sallulabs.com;
    return 404; # managed by Certbot
}
```

## Test SSL Certificate

```bash
# Check certificate status
sudo certbot certificates

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Test HTTPS access
curl -I https://bgremover.sallulabs.com
```

## Auto-Renewal Setup

Certbot already sets up auto-renewal, but verify:

```bash
# Check cron job
sudo crontab -l

# Should see something like:
0 12 * * * /usr/bin/certbot renew --quiet

# Test renewal process
sudo certbot renew --dry-run
```

## Cloudflare Considerations

Since you're using Cloudflare:

1. **Set SSL/TLS mode to "Full"** in Cloudflare dashboard
2. **Disable Cloudflare SSL** temporarily while getting certificate
3. **Re-enable after certificate is issued**

Or use Cloudflare's origin certificate instead:
```bash
# Alternative: Use Cloudflare Origin Certificate
# But Let's Encrypt is simpler and works fine
```

## Troubleshooting

### DNS Propagation
```bash
# Check if DNS is pointing correctly
dig bgremover.sallulabs.com
nslookup bgremover.sallulabs.com

# Should show your server IP
```

### Certificate Issues
```bash
# Check certificate details
sudo openssl x509 -in /etc/letsencrypt/live/bgremover.sallulabs.com/fullchain.pem -text -noout

# Renew manually if needed
sudo certbot renew --cert-name bgremover.sallulabs.com
```

---

**Run the certbot command with your subdomain and you'll have HTTPS in minutes!** 🚀
