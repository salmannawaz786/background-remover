# Network/DNS Issue Fix

## Problem
You're seeing DNS resolution errors for `oauth2.googleapis.com`:
```
NameResolutionError: Failed to resolve 'oauth2.googleapis.com' ([Errno 11001] getaddrinfo failed)
```

This means your computer can't connect to Google's authentication servers.

## Possible Causes

### 1. **Firewall/Antivirus Blocking**
- Windows Firewall might be blocking Python
- Antivirus software blocking network access
- Corporate firewall blocking Google services

### 2. **VPN/Proxy Issues**
- VPN is interfering with DNS resolution
- Proxy settings misconfigured
- Network routing problems

### 3. **DNS Server Problems**
- ISP DNS server down or slow
- Local DNS cache corrupted
- DNS filtering by ISP or network admin

### 4. **No Internet Connection**
- Temporarily offline
- Network adapter issues

## Quick Fixes (Try in Order)

### Fix 1: Check Internet Connection
```powershell
ping google.com
```
If this fails, your internet is down.

### Fix 2: Flush DNS Cache
```powershell
ipconfig /flushdns
ipconfig /registerdns
```

### Fix 3: Change DNS to Google DNS
1. Open **Network and Sharing Center**
2. Click your network connection
3. Click **Properties**
4. Select **Internet Protocol Version 4 (TCP/IPv4)**
5. Click **Properties**
6. Select **Use the following DNS server addresses**:
   - Preferred DNS: `8.8.8.8`
   - Alternate DNS: `8.8.4.4`
7. Click **OK**

### Fix 4: Disable VPN Temporarily
If you're using a VPN, try disabling it and test again.

### Fix 5: Allow Python Through Firewall
1. Open **Windows Defender Firewall**
2. Click **Allow an app through firewall**
3. Find Python (or add it)
4. Check both **Private** and **Public**
5. Click **OK**

### Fix 6: Test Firebase Connection
```python
# Test if you can reach Google
import socket
try:
    socket.gethostbyname('oauth2.googleapis.com')
    print("✅ Can reach Google servers")
except:
    print("❌ Cannot reach Google servers")
```

## Temporary Solution: Disable Firebase

If you need the app working NOW while you fix network issues:

### Create `.env` file:
```env
SECRET_KEY=your-secret-key-here
MAX_WORKERS=8
MODEL_NAME=u2net
# Leave Firebase empty to disable
FIREBASE_CREDENTIALS_PATH=
FIREBASE_STORAGE_BUCKET=
```

The app will work without Firebase - images just won't be stored in the cloud.

## After Fixing Network

Once your network issue is resolved:

1. **Re-enable Firebase** in `.env`:
   ```env
   FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
   FIREBASE_STORAGE_BUCKET=imagetotext-4c3e3.appspot.com
   ```

2. **Grant cross-project permissions** (as instructed in FIREBASE_FIX_GUIDE.md)

3. **Test**: Upload should work in ~7 seconds without errors

## Performance Impact

The code now has aggressive timeouts:
- Firebase upload timeout: 5 seconds max
- Total wait for Firebase: 5 seconds
- If Firebase fails, app continues immediately

**Result**: Even if Firebase has issues, your app responds quickly!

## Still Having Issues?

### Check Logs
Look for:
- ✅ `"Using Firebase credentials from file"` - Good
- ✅ `"Firebase initialized successfully"` - Good
- ⚠️ `"Firebase upload timed out"` - Network issue but app works
- ⚠️ `"Firebase upload failed: NameResolutionError"` - DNS issue but app works

### Test Without Firebase
Create `.env` with empty Firebase settings and restart:
```powershell
cp .env.example .env
# Edit .env and leave Firebase lines empty
python server.py
```

If it works without Firebase, it's definitely a network/DNS issue.
