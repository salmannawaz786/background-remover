# Setup HTTPS with SSL Certificate

## Get SSL Certificate

```bash
# Install certbot if not already installed
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate for your subdomain
sudo certbot --nginx -d bgremover.sallulabs.com

# Follow the prompts - choose option 2 (Redirect) to force HTTPS
```

## After SSL Setup

Your nginx config will be automatically updated with:
- SSL certificate paths
- HTTP to HTTPS redirect
- SSL security settings

## Test HTTPS

```bash
# Test HTTPS
curl -I https://bgremover.sallulabs.com

# Check certificate
sudo certbot certificates
```

## Auto-Renewal

Certbot sets up auto-renewal automatically. Verify:
```bash
# Check cron job
sudo crontab -l

# Test renewal
sudo certbot renew --dry-run
```

## Update URLs in Your App

After HTTPS is working, update any hardcoded URLs:
- Firebase redirect URLs
- R2 public domain
- Any API endpoints

---

**Run the certbot command to get your SSL certificate!** 🔒
