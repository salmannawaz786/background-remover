# Firebase Configuration Fix Guide

## Problem Identified
You're getting a 403 error because there's a **mismatch between your Firebase service account and storage bucket**:
- Service Account: `firebase-adminsdk-m8i9d@are-you-genius-1f253.iam.gserviceaccount.com`
- Trying to access bucket: `imagetotext-4c3e3.appspot.com`

These belong to **different Firebase projects**, which is why you're getting permission denied.

## Solutions (Choose ONE)

### Option 0: Cross-Project Storage (YOUR CASE - RECOMMENDED)
If you want to use a bucket from a different project, you need to grant your service account access to that bucket:

#### Steps:
1. **Go to Google Cloud Console** for the `imagetotext-4c3e3` project:
   - Visit: https://console.cloud.google.com/
   - Switch to project: `imagetotext-4c3e3`

2. **Navigate to Cloud Storage**:
   - Go to: https://console.cloud.google.com/storage/browser
   - Click on bucket: `imagetotext-4c3e3.appspot.com`

3. **Grant Access to Service Account**:
   - Click on the **Permissions** tab
   - Click **+ GRANT ACCESS** button
   - In "Add principals", paste your service account email:
     ```
     firebase-adminsdk-m8i9d@are-you-genius-1f253.iam.gserviceaccount.com
     ```
   - In "Select a role", choose: **Storage Object Admin**
   - Click **SAVE**

4. **Update your `.env` file**:
   ```env
   FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
   FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
   ```

5. **Restart your server** and test again!

That's it! Your service account will now have permission to upload to the cross-project bucket.

### Option 1: Use the Correct Storage Bucket (RECOMMENDED)
Update your `.env` file to use the correct bucket that matches your service account:

```env
FIREBASE_STORAGE_BUCKET=are-you-genius-1f253.appspot.com
```

### Option 2: Update Service Account Credentials
If you want to use the `imagetotext-4c3e3` bucket, you need to:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select the `imagetotext-4c3e3` project
3. Go to **Project Settings** > **Service Accounts**
4. Click **Generate New Private Key**
5. Save the JSON file as `firebase-credentials.json` in your project root
6. Update your `.env` file:
   ```env
   FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
   FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
   ```

### Option 3: Disable Firebase Storage (Quick Fix)
If you don't need cloud storage, simply remove or comment out Firebase configuration:

1. Create `.env` file if it doesn't exist
2. Don't set the Firebase variables (or set empty values)
3. The app will work without Firebase - images will be returned directly to the user

## Setup Steps

### 1. Create `.env` File
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 2. Edit `.env` File
Choose your configuration based on the option above:

```env
# Security
SECRET_KEY=your-secret-key-here-change-this-in-production

# Performance Settings
MAX_WORKERS=8
MODEL_NAME=u2net

# Firebase Configuration (MATCH YOUR PROJECT)
# Option 1: Use correct bucket for current credentials
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
FIREBASE_STORAGE_BUCKET=are-you-genius-1f253.appspot.com

# OR leave empty to disable Firebase
# FIREBASE_CREDENTIALS_PATH=
# FIREBASE_STORAGE_BUCKET=
```

### 3. Verify Permissions
If using Firebase, ensure the service account has these permissions:
- `storage.objects.create`
- `storage.objects.get`
- `storage.objects.update`

To grant permissions:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **IAM & Admin** > **IAM**
4. Find your service account
5. Click **Edit** and add role: **Storage Object Admin**

## Performance Improvements Applied

### 1. Faster Response Time
- Added 10-second timeout to Firebase upload
- Changed error to warning (won't block response)
- Users get processed image immediately, even if upload fails

### 2. Better Error Handling
- Firebase failures no longer add 20+ seconds of wait time
- Logs are cleaner with truncated error messages
- App continues working even without Firebase

## Expected Behavior After Fix

✅ **Without Firebase**: Images process in ~12s and return immediately  
✅ **With Firebase (correct config)**: Images process in ~12s, upload in ~2s  
❌ **With Firebase (wrong config)**: Images process in ~12s, fail immediately with warning

## Testing
After making changes, restart your server and test:
```bash
python server.py
```

Upload an image and check:
- Processing should complete in ~12 seconds
- You should NOT see 403 errors
- If Firebase is configured, check logs for successful upload
- If Firebase is disabled, you should see a warning on startup
