# Firebase Configuration for Google Sign-In

## Issue: Unauthorized Domain Error

When using Google Sign-In in your Electron app, you're getting an "unauthorized domain" error because Firebase doesn't recognize `localhost` or Electron's custom protocols.

## Solution: Add Authorized Domains

1. **Go to Firebase Console:**
   - Visit: https://console.firebase.google.com/
   - Select your project: **are-you-genius-1f253**

2. **Navigate to Authentication Settings:**
   - Click "Authentication" in left sidebar
   - Click "Settings" tab
   - Click "Authorized domains" section

3. **Add These Domains:**
   - `localhost` (if not already there)
   - `127.0.0.1` (if not already there)
   - `are-you-genius-1f253.firebaseapp.com` (should already be there)

4. **For Electron Specifically:**
   Since Electron uses custom protocols, you have two options:

   **Option A: Use Firebase Auth REST API (Recommended for Desktop)**
   Instead of `signInWithPopup`, use `signInWithCredential` with a custom OAuth flow.

   **Option B: Use WebView with Authorized Domain**
   Configure Firebase to accept your app's domain.

## Current Workaround

For now, **email/password authentication will work perfectly**. Google Sign-In in Electron requires additional configuration.

### Recommended Approach for Production:

Use email/password authentication as the primary method for the desktop app. Google Sign-In works better on web apps.

**Why?**
- Electron apps don't have a traditional domain
- Email verification code flow is more secure for desktop apps
- Users expect different auth flows on desktop vs web

## Current Status

✅ Email/Password Login - **WORKS**
✅ Email/Password Signup with Verification Code - **WORKS**
⚠️ Google Sign-In - **Needs Firebase configuration** (web-only feature for now)

## Alternative: Remove Google Sign-In from Desktop App

Since this is a desktop app, you can remove Google Sign-In buttons and only use email/password authentication. This is actually more common for desktop applications.

Would you like me to:
1. Remove Google Sign-In buttons from desktop app?
2. Or implement a custom OAuth flow for Google Sign-In?

Let me know your preference!
