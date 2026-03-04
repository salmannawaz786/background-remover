# Cache Busting & Email OTP - Implementation Guide

## ✅ Cache Busting Implemented

### What I Fixed
Users no longer need to manually clear their cache! All static files now have version numbers.

### How It Works
Every CSS, JS, and static file now has a version parameter:
```html
<link rel="stylesheet" href="../static/navbar.css?v=1.0.1">
<script src="../static/app.js?v=1.0.1"></script>
```

When you update a file, just change the version number and browsers will automatically fetch the new version.

### Updated Files
- ✅ `templates/index.html` - All CSS/JS files have `?v=1.0.1`
- ✅ `static/sw.js` - Cache name changed to `bg-remover-v1.0.1`
- ✅ Service worker now caches versioned URLs

### How to Update Version in Future

**For small CSS/JS changes:**
1. Edit your file (e.g., `navbar.css`)
2. Open `templates/index.html`
3. Change `?v=1.0.1` to `?v=1.0.2` for that file
4. Push to GitHub
5. Restart server

**For major updates:**
- Use `?v=1.1.0` for new features
- Use `?v=2.0.0` for big changes

**Update service worker too:**
```javascript
// In static/sw.js
const CACHE_NAME = 'bg-remover-v1.0.2'; // Match your version
```

---

## ✅ Brevo Email OTP Verification Implemented

### New Files Created
1. **`brevo_email.py`** - Email OTP service
   - Sends beautiful HTML emails via Brevo API
   - Generates 6-digit OTP codes
   - 10-minute expiration
   - Max 3 verification attempts

2. **Flask Routes Added to `server.py`**
   - `POST /api/send-otp` - Send OTP to email
   - `POST /api/verify-otp` - Verify OTP code

### Environment Variables
Already configured in your `.env`:
```bash
BREVO_API_KEY=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
BREVO_SENDER_EMAIL=noreply@sallulabs.com
```

### How to Use OTP System

**Send OTP:**
```javascript
const response = await fetch('/api/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com' })
});
```

**Verify OTP:**
```javascript
const response = await fetch('/api/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        email: 'user@example.com',
        otp: '123456'
    })
});
```

### Email Template
Beautiful yellow-themed email with:
- SalluLabs branding
- Large OTP code display
- 10-minute expiration notice
- Responsive design

---

## 🐛 Authentication Issue

The "Authentication failed" error is likely due to:

### Common Causes:
1. **Firebase configuration mismatch** - Check if `serviceAccountKey.json` exists
2. **CORS issues** - Make sure domain is in allowed origins
3. **Token expiration** - Firebase tokens expire
4. **Network issues** - Check server logs

### Debug Steps:

**1. Check Firebase credentials:**
```bash
# On server
ls -la ~/background-remover/serviceAccountKey.json
```

**2. Check server logs:**
```bash
sudo journalctl -u bgremover.service -n 50
```

**3. Test Firebase Auth:**
```bash
# In browser console
console.log(firebase.auth().currentUser);
```

**4. Check CORS:**
```python
# In server.py, verify this includes your domain
ALLOWED_ORIGINS = [
    'https://bgremover.sallulabs.com',
    'http://localhost:5001',
    'http://127.0.0.1:5001',
]
```

### Fix Authentication:

**Option 1: Use Email OTP Instead**
- Implement OTP-based login (no Firebase dependency)
- Users get code via email
- Verify OTP and create session

**Option 2: Debug Firebase**
```javascript
// In firebaseauth.js, add detailed error logging
catch (error) {
    console.error('Full error:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
}
```

---

## 📦 Deployment Checklist

### 1. Install Dependencies
```bash
pip install requests
# or
pip install -r requirements.txt
```

### 2. Add Environment Variables
Make sure `.env` has:
```bash
BREVO_API_KEY=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
BREVO_SENDER_EMAIL=noreply@sallulabs.com
```

### 3. Push to GitHub
```bash
git add .
git commit -m "Add cache busting and Brevo email OTP verification"
git push origin master
```

### 4. Deploy to Server
```bash
# On server
cd ~/background-remover
git pull origin master
pip install requests
sudo systemctl restart bgremover
```

### 5. Test Everything
```bash
# Test OTP endpoint
curl -X POST https://bgremover.sallulabs.com/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Check cache busting
curl -I https://bgremover.sallulabs.com/static/navbar.css?v=1.0.1
```

---

## 🎯 Summary

### What's Fixed
✅ **Cache Busting** - Users get updates automatically  
✅ **Email OTP** - Ready to use for verification  
✅ **Version Control** - Easy to update in future  

### What to Do Next
1. Push changes to GitHub
2. Pull on server and restart
3. Test cache busting (update a CSS file)
4. Test OTP system (send test email)
5. Debug Firebase auth issue (check logs)

### Future Updates
To update any CSS/JS file:
1. Edit the file
2. Change `?v=1.0.1` to `?v=1.0.2` in `index.html`
3. Update `CACHE_NAME` in `sw.js`
4. Push and restart

No more cache issues! 🚀

---

## 📝 Quick Commands

```bash
# Push changes
git add .
git commit -m "Cache busting and OTP implemented"
git push origin master

# On server
cd ~/background-remover
git pull origin master
pip install requests
sudo systemctl restart bgremover

# Test
curl https://bgremover.sallulabs.com/health
```
