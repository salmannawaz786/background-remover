# Brevo API Security Setup - Option 1

## ✅ Security Improved!

The Brevo API key is now moved from hardcoded code to environment variables.

## What Changed

### 1. Updated `.env.example`
Added Brevo configuration:
```bash
# Brevo Email Service (for OTP verification)
BREVO_API_KEY=xkeysib-YOUR-BREVO-API-KEY-HERE
BREVO_SENDER_EMAIL=noreply@sallulabs.com
```

### 2. Updated `brevo_email.py`
- Removed hardcoded API key
- Now reads from environment variable
- Added validation for missing API key

## Setup Instructions

### On Your Local Machine

1. **Create `.env` file:**
```bash
# Copy the example file
cp .env.example .env
```

2. **Edit `.env` file:**
```bash
nano .env
```

3. **Add your actual API key:**
```bash
# Replace with your actual Brevo API key
BREVO_API_KEY=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
BREVO_SENDER_EMAIL=noreply@sallulabs.com
```

### On Production Server (DigitalOcean)

1. **SSH into server:**
```bash
ssh root@your-server-ip
cd ~/background-remover
```

2. **Create `.env` file:**
```bash
cp .env.example .env
nano .env
```

3. **Add your actual API key:**
```bash
BREVO_API_KEY=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
BREVO_SENDER_EMAIL=noreply@sallulabs.com
```

4. **Save and restart service:**
```bash
# Save (Ctrl+X, Y, Enter)
# Restart the service
sudo systemctl restart bgremover
```

## Security Benefits

### Before (Less Secure):
```python
# API key was visible in code
BREVO_API_KEY = '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'
```

### After (More Secure):
```python
# API key is in environment variable
BREVO_API_KEY = os.getenv('BREVO_API_KEY')  # Not visible in code
```

## Additional Security Tips

### 1. Never Commit `.env` to Git
Make sure `.env` is in `.gitignore`:
```bash
# Check .gitignore
cat .gitignore | grep .env
# Should show: .env
```

### 2. Use Different Keys for Different Environments
```bash
# Development
BREVO_API_KEY=xkeysib-dev-key-here

# Production
BREVO_API_KEY=xkeysib-prod-key-here
```

### 3. Monitor Brevo Usage
- Check your Brevo dashboard regularly
- Set up alerts for unusual activity
- Brevo has built-in rate limiting

## Test the Setup

### 1. Test Locally:
```bash
# Make sure .env has the API key
cat .env | grep BREVO_API_KEY

# Test the OTP endpoint
curl -X POST http://localhost:5001/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

### 2. Test on Server:
```bash
# Check service is running
sudo systemctl status bgremover

# Test OTP endpoint
curl -X POST https://bgremover.sallulabs.com/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Troubleshooting

### If OTP Doesn't Work:

1. **Check API key in .env:**
```bash
cat .env | grep BREVO_API_KEY
```

2. **Check server logs:**
```bash
sudo journalctl -u bgremover.service -n 20
```

3. **Check Brevo API key validity:**
- Log into Brevo dashboard
- Verify API key is active
- Check sending limits

### Common Errors:

**"Brevo API key not configured"**
- API key missing from .env file
- Service needs restart after adding key

**"Failed to send OTP email"**
- Invalid API key
- Brevo account limits reached
- Network issues

## Security Level After Changes: ✅ High

- ✅ API key not in code
- ✅ Environment variable protected
- ✅ Server-side only
- ✅ Brevo rate limiting
- ✅ Error handling for missing key

---

## Quick Commands

```bash
# Setup on server
cd ~/background-remover
cp .env.example .env
nano .env
# Add your API key
sudo systemctl restart bgremover

# Test
curl -X POST https://bgremover.sallulabs.com/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

**Your Brevo API is now secure!** 🔒
