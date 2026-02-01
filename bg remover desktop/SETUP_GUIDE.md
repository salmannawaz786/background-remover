# BG Remover Desktop - Setup Guide

## � Brevo Email Setup (RECOMMENDED)

Brevo (formerly Sendinblue) offers **300 FREE emails/day** - much better than EmailJS!

### Step 1: Get Your Brevo API Key
1. Go to https://app.brevo.com/
2. Login to your account
3. Navigate to: **Settings** → **SMTP & API** → **API Keys**
4. Click **Generate a new API key**
5. Copy the API key

### Step 2: Verify Your Sender Domain (sallulabs.com)
1. Go to: **Settings** → **Senders, Domains & Dedicated IPs**
2. Click **Domains** tab
3. Click **Add a domain**
4. Enter: `sallulabs.com`
5. Brevo will give you DNS records to add

### Step 3: Add DNS Records in Cloudflare
1. Go to https://dash.cloudflare.com/
2. Select `sallulabs.com`
3. Go to **DNS** → **Records**
4. Add the records Brevo provided:

```
Type: TXT
Name: @
Content: (Brevo verification code)

Type: TXT  
Name: mail._domainkey
Content: (Brevo DKIM key)
```

5. Wait for verification (usually 5-30 minutes)

### Step 4: Update auth-renderer.js
```javascript
const BREVO_API_KEY = 'xkeysib-xxxxxxxx';  // Your API key
const SENDER_EMAIL = 'noreply@sallulabs.com';
const SENDER_NAME = 'SalluLabs BG Remover';
```

### Brevo Free Tier Limits
- ✅ **300 emails/day** (9,000/month)
- ✅ Unlimited contacts
- ✅ Custom domain support
- ✅ No credit card required

---

## 🔥 Firebase Free Tier Limits

### Authentication
- **FREE**: Unlimited email/password & Google Sign-In users
- Phone auth: 10K SMS/month free

### Firestore (Database)
- **Storage**: 1 GB free
- **Reads**: 50K/day free
- **Writes**: 20K/day free
- **Deletes**: 20K/day free

### Firebase Storage (Images)
- **Storage**: 5 GB free ✅
- **Downloads**: 1 GB/day free
- **Uploads**: 20K operations/day free

**For BG Remover app: 5GB = ~10,000-25,000 processed images (depending on size)**

---

## 🔐 Google Sign-In Setup with sallulabs.com

### Step 1: Google Cloud Console
1. Go to https://console.cloud.google.com/
2. Select your Firebase project (are-you-genius-1f253)

### Step 2: Enable Google Sign-In API
1. APIs & Services → Library
2. Search "Google+ API" or "Google Identity Services"
3. Enable it

### Step 3: Create OAuth Client ID
1. APIs & Services → Credentials
2. Create Credentials → OAuth client ID
3. Application type: **Web application**
4. Name: "BG Remover Desktop - SalluLabs"
5. **Authorized JavaScript origins:**
   - `https://sallulabs.com`
   - `https://auth.sallulabs.com`
   - `https://are-you-genius-1f253.firebaseapp.com`
6. **Authorized redirect URIs:**
   - `https://auth.sallulabs.com/callback`
   - `https://are-you-genius-1f253.firebaseapp.com/__/auth/handler`
7. Copy the **Client ID**

### Step 4: Update auth.js
```javascript
const GOOGLE_CLIENT_ID = 'xxxxxx.apps.googleusercontent.com';
```

### Step 5: Firebase Console
1. Go to Firebase Console → Authentication
2. Sign-in method → Google → Enable
3. Add your domain: Settings → Authorized domains → Add `sallulabs.com`

---

## 🌐 Cloudflare Setup for sallulabs.com

### Add Auth Subdomain for Google OAuth

1. Go to https://dash.cloudflare.com/
2. Select `sallulabs.com`
3. Go to **DNS** → **Records**

### Option A: Redirect to Firebase (Easiest)
Add a Page Rule or Redirect Rule:
```
From: auth.sallulabs.com/callback*
To: https://are-you-genius-1f253.firebaseapp.com/__/auth/handler$1
Type: 301 Redirect
```

### Option B: CNAME to Firebase
```
Type: CNAME
Name: auth
Target: are-you-genius-1f253.firebaseapp.com
Proxy: OFF (DNS only - gray cloud)
```

### Add Custom Domain to Firebase Hosting (Optional)
1. Firebase Console → Hosting
2. Add custom domain: `auth.sallulabs.com`
3. Follow verification steps
4. Add the DNS records Cloudflare

### Cloudflare SSL Settings
1. Go to **SSL/TLS** → **Overview**
2. Set to **Full (strict)**
3. Go to **Edge Certificates**
4. Enable **Always Use HTTPS**

---

## 💾 Firebase Storage Rules

Update your Firebase Storage rules to allow authenticated users:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // User-specific files
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Public files (optional)
    match /public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

---

## 🎨 App Icons

### Required Files
Place in `assets/` folder:
- `icon.ico` - Windows (multi-resolution)
- `icon.icns` - macOS (multi-resolution)  
- `icon.png` - Linux (512x512)

### Create Icons
1. Start with your 1024x1024 PNG logo
2. Use https://convertio.co/png-ico/ for Windows
3. Use https://cloudconvert.com/png-to-icns for macOS

---

## 🚀 Build & Distribute

### Development
```bash
npm start
npm start -- --dev  # With DevTools
```

### Build for Distribution
```bash
npm run build:win    # Windows .exe
npm run build:mac    # macOS .dmg (requires macOS)
npm run build:linux  # Linux .AppImage
```

Built files appear in `dist/` folder.

---

## ⚙️ Environment Variables (Production)

For production, consider using environment variables:

```javascript
// In auth-renderer.js
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || 'YOUR_SERVICE_ID';
```

Or use a config file that's not committed to git.

---

## 📱 Current Features

✅ Email/Password Authentication
✅ Email Verification Codes
✅ Google Sign-In (with setup)
✅ Firebase Storage for processed images
✅ User-friendly error messages
✅ Dark mode support
✅ Single & batch image processing
✅ HD quality processing

---

## 🔧 Troubleshooting

### "Network error" on login
- Check internet connection
- Verify Firebase project is active

### "Email already in use"
- User already registered, switch to Login tab

### "Invalid verification code"
- Code expires after 10 minutes
- Click "Resend Code" for new one

### Google Sign-In not working
- Verify Client ID is correct
- Check Firebase Auth settings
- Ensure redirect URI matches exactly

### Images not uploading to Storage
- Check Storage rules in Firebase Console
- Verify user is authenticated
- Check console for errors

---

## 📊 Monitoring Usage

Firebase Console → Usage and billing
- Monitor authentication attempts
- Track storage usage
- View Firestore read/writes

Stay within free tier:
- 5GB storage = ~10K-25K images
- 200 emails/month with EmailJS free tier
- Unlimited auth users
