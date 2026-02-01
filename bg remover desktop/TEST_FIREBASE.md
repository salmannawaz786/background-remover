# 🧪 Test Firebase Upload

## Step-by-Step Testing Guide

### 1. Open DevTools FIRST
```bash
npm start
```
Press **F12** to open DevTools **BEFORE** you do anything else.

---

### 2. Check Firebase Initialization

In the Console tab, you should see:
```
🔄 Initializing Firebase Storage...
✅ Firebase Storage initialized!
Storage bucket: are-you-genius-1f253.firebasestorage.app
window.firebaseStorage: SET
```

**If you DON'T see this**, Firebase didn't load. Check:
- Internet connection
- CSP errors in Console
- Blocked requests in Network tab

---

### 3. Check Firebase Storage Object

In the Console tab, type this and press Enter:
```javascript
window.firebaseStorage
```

You should see:
```javascript
{storage: {...}, ref: ƒ, uploadBytes: ƒ, getDownloadURL: ƒ}
```

**If you see `undefined`**, Firebase didn't initialize.

---

### 4. Process an Image

1. Click "Select Image"
2. Choose any image
3. Wait for processing to complete

---

### 5. Watch Upload Logs

After processing completes, you should see in Console:
```
🔄 Starting Firebase upload process...
✓ Online
✓ Firebase Storage object available
✓ Auth state: authenticated
✓ User: your@email.com UID: abc123...
🔄 Converting image to blob...
✓ Blob created, size: 123.45 KB
✓ Storage path: users/abc123.../processed/1738347890123_image.png
✓ Storage reference created
📤 Uploading to Firebase Storage...
✓ Upload complete!
🔄 Getting download URL...
✅ SUCCESS! Firebase Storage URL: https://firebasestorage.googleapis.com/...
```

---

### 6. Common Errors & Fixes

#### ❌ "window.firebaseStorage not found"
**Cause:** Firebase didn't initialize
**Fix:** Check internet connection, reload app

#### ❌ "Not authenticated - skipping upload"
**Cause:** Not logged in
**Fix:** Login first, then process image

#### ❌ "storage/unauthorized"
**Cause:** Firebase Storage rules blocking upload
**Fix:** Update Firebase Storage Rules in Firebase Console:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

#### ❌ "Failed to fetch"
**Cause:** Network issue or CORS
**Fix:** 
1. Check internet connection
2. Check Firebase project settings
3. Try restarting app

---

### 7. Verify Upload in Firebase Console

1. Go to: https://console.firebase.google.com/
2. Select project: `are-you-genius-1f253`
3. Click **Storage** in left menu
4. Navigate to: `users/[your-uid]/processed/`
5. You should see your uploaded images!

---

### 8. If Still Not Working

Send me the **EXACT console output** after processing an image. Copy everything from:
```
🔄 Starting Firebase upload process...
```
to the end of the logs.

Also send any **red errors** you see in the Console.

---

## Quick Debug Commands

Type these in Console (F12) to debug:

```javascript
// Check if Firebase loaded
console.log('Firebase Storage:', window.firebaseStorage ? 'YES' : 'NO');

// Check auth state
window.electronAPI.auth.getState().then(state => console.log('Auth:', state));

// Check online status
console.log('Online:', navigator.onLine);

// Manual upload test (after processing an image)
uploadToFirebaseStorage(document.getElementById('result-image').src, 'test.png')
  .then(url => console.log('Upload URL:', url))
  .catch(err => console.error('Upload error:', err));
```

---

## Expected Firebase Console Logs (Good)

```
✅ Firebase Storage initialized and ready
✓ Firebase Storage found
✓ User authenticated: user@example.com
✓ Image converted to blob, size: 234.56 KB
✓ Storage path: users/abc123def456/processed/1738347890123_image.png
✓ Storage reference created
📤 Uploading to Firebase Storage...
✓ Upload complete!
✅ SUCCESS! Firebase Storage URL: https://...
```

If you see all ✓ and ✅, upload is working!
