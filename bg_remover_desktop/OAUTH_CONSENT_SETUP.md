# Fix Google OAuth Consent Screen Domain

## Problem
Google OAuth shows "are-you-genius-1f253.firebaseapp.com" instead of "sallulabs.com"

---

## Solution: Configure OAuth Consent Screen with Custom Domain

### Step 1: Verify Domain Ownership in Google Search Console

**IMPORTANT: Use the SAME Google account for both Search Console AND Google Cloud Console!**

1. Go to https://search.google.com/search-console/
2. Make sure you're logged in with the **SAME Google account** as your Google Cloud project
3. Check if `sallulabs.com` is already verified:
   - If you see a green checkmark ✅ next to it → Already verified, skip to Step 2
   - If status is pending or failed → Continue below

4. Add/Re-verify property:
   - Click **Add property** → **Domain** (not URL prefix)
   - Enter: `sallulabs.com` (without https://)
   - Google will provide a TXT record

5. **Add DNS TXT record via Cloudflare:**
   ```
   Go to: https://dash.cloudflare.com/
   Select: sallulabs.com
   Go to: DNS → Records → Add record
   
   Type: TXT
   Name: @ (or sallulabs.com)
   Content: google-site-verification=xxxxxxxxxxxxx (copy from Search Console)
   TTL: Auto
   Proxy status: DNS only (gray cloud)
   ```

6. **Wait 2-5 minutes** for DNS propagation

7. Go back to Search Console → Click **VERIFY**

8. **If verification fails:**
   - Check you're using the correct Google account
   - Wait longer (up to 24 hours for DNS propagation)
   - Try alternative verification method (HTML file or meta tag)

---

### Alternative: HTML File Verification (Faster)

If DNS verification keeps failing:

1. Search Console → Choose **HTML file upload** method
2. Download the verification file (e.g., `google1234567890abcdef.html`)
3. Upload to your website root: `https://sallulabs.com/google1234567890abcdef.html`
4. Make sure the file is publicly accessible
5. Click **VERIFY** in Search Console

---

### Step 2: Configure OAuth Consent Screen

1. Go to https://console.cloud.google.com/apis/credentials/consent
2. Select your project: **are-you-genius-1f253**

3. **OAuth consent screen settings:**

   - **App name:** `SalluLabs BG Remover`
   - **User support email:** `support@sallulabs.com`
   - **App logo:** Upload your logo (120x120 PNG)
   - **Application home page:** `https://sallulabs.com`
   - **Application privacy policy:** `https://sallulabs.com/privacy`
   - **Application terms of service:** `https://sallulabs.com/terms`
   - **Authorized domains:** Add `sallulabs.com` ✅

4. **Developer contact information:**
   - Email: `your-email@sallulabs.com`

5. Click **SAVE AND CONTINUE**

---

### ⚠️ Troubleshooting: "Website not registered to you" Error

If you get this error when adding your homepage URL:

#### Issue: Google account mismatch
**Solution:**
1. Check which Google account you're logged into:
   - Search Console account: _______________
   - Cloud Console account: _______________
   - **They MUST be the same!**

2. If different accounts:
   - **Option A:** Add the Cloud Console account as an owner in Search Console
     - Search Console → Settings (⚙️) → Users and permissions
     - Add user → Enter Cloud Console email → Owner access
   
   - **Option B:** Switch to the Search Console account in Cloud Console
     - Cloud Console → Select project → IAM → Add member
     - Or transfer project ownership

#### Issue: Domain not verified yet
**Solution:**
1. Go to https://search.google.com/search-console/
2. Check verification status of `sallulabs.com`
3. If not verified or expired, re-verify using DNS or HTML method above

#### Issue: Using wrong property type
**Solution:**
- Make sure you added `sallulabs.com` as a **Domain property**, not URL prefix
- Domain property = `sallulabs.com` (covers all subdomains and protocols)
- URL prefix = `https://sallulabs.com` (only that exact URL)

#### Quick Fix: Skip Homepage Verification (Temporary)
If verification keeps failing, you can temporarily:
1. Leave **Application home page** blank
2. Or use: `https://are-you-genius-1f253.firebaseapp.com`
3. Come back and update it later after domain verification is sorted

---

### Step 3: Add Scopes

1. Click **ADD OR REMOVE SCOPES**
2. Add these scopes:
   - `.../auth/userinfo.email` - See your email address
   - `.../auth/userinfo.profile` - See your personal info
3. Click **UPDATE**
4. Click **SAVE AND CONTINUE**

---

### Step 4: Test Users (If in Testing Mode)

If your app is still in "Testing" mode:
1. Add test users' email addresses
2. Or publish the app (requires verification if requesting sensitive scopes)

For basic email/profile access, you can publish without verification.

---

### Step 5: Publish App (Optional)

1. Go back to **OAuth consent screen**
2. Click **PUBLISH APP**
3. Confirm

**Note:** For basic scopes (email, profile), no Google verification is needed.

---

## Alternative: Use Firebase Custom Domain

If you don't want to go through OAuth consent screen setup:

### Option A: Add Custom Domain to Firebase Hosting

1. Firebase Console → Hosting → Add custom domain
2. Add: `auth.sallulabs.com`
3. Follow DNS setup instructions
4. Add in Cloudflare:
   ```
   Type: A
   Name: auth
   IPv4: (Firebase provided IPs)
   Proxy: ON (orange cloud)
   ```

5. Update `auth.js`:
   ```javascript
   const redirectUri = 'https://auth.sallulabs.com/__/auth/handler';
   ```

6. Update Google OAuth Client redirect URIs:
   - Add `https://auth.sallulabs.com/__/auth/handler`

---

## Firebase Action Code Settings (Password Reset)

Already configured in auth-renderer.js:

```javascript
const actionCodeSettings = {
    url: 'https://sallulabs.com/auth/reset-complete',
    handleCodeInApp: false
};
```

### To customize email domain:

1. Firebase Console → Authentication → Templates
2. Click on "Password reset" template
3. Change "From name" to: `SalluLabs`
4. Customize email subject and body

**For custom sender domain (noreply@sallulabs.com):**
- This requires Firebase Blaze plan (pay-as-you-go)
- Free plan sends from: `noreply@are-you-genius-1f253.firebaseapp.com`

---

## Summary

### Quick Fix (No Custom Domain):
✅ Already works - just shows Firebase domain in consent screen
- Users can still sign in normally
- Only cosmetic issue

### Full Custom Domain (Recommended):
1. Verify `sallulabs.com` in Google Search Console
2. Add `sallulabs.com` to OAuth consent screen authorized domains
3. Update app name to "SalluLabs BG Remover"
4. Add app logo and privacy/terms URLs
5. Publish app

### Firebase Email Customization:
- Free plan: Email from `noreply@[project-id].firebaseapp.com`
- Paid plan: Email from `noreply@sallulabs.com`

---

## Status Check

After changes, wait 5-10 minutes and test Google Sign-In again. The consent screen should now show:

```
┌─────────────────────────────────────┐
│  🎨 SalluLabs BG Remover            │  ← Your app name
│                                     │
│  wants to access your Google Account│
│                                     │
│  This will allow SalluLabs BG Remover│
│  to:                                 │
│  • See your email address            │
│  • See your personal info            │
│                                     │
│  sallulabs.com                      │  ← Your domain!
│                                     │
│  [Continue]    [Cancel]             │
└─────────────────────────────────────┘
```
